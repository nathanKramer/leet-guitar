import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorState } from '../editor/editorStore';
import { audition, placeNote, shiftSelection, stepTicks } from '../editor/actions';
import { barTicks, beatTicks, describeDuration } from '../model/durations';
import { isCymbal, laneLabel } from '../model/drums';
import { isStringed } from '../model/instruments';
import { visibleLanes } from '../model/lanes';
import { isBlackKey, pitchName } from '../model/music';
import { clampShift, type NoteShift } from '../model/commands';
import type { ID, Note, Song } from '../model/types';
import { editor } from '../session';
import type { PeerState } from '../sync/awareness';

const RULER_H = 22;
const PAD = 8;
/** Space between stacked rows. */
const ROW_GAP = 16;
const RIGHT_PAD = 12;
/** Width of the lane labels at the left of each row. */
const GUTTER: Record<string, number> = { guitar: 34, bass: 34, piano: 44, drums: 84 };
const ROW_H = 26;
const CHIP_H = 20;
const PIANO_ROW_H = 14;
const PIANO_CHIP_H = 12;

interface Props {
  song: Song;
  ed: EditorState;
  peers: PeerState[];
}

interface Drag {
  ids: ID[];
  /** The note that was grabbed; it's auditioned as the pitch changes. */
  anchor: ID;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
}

/** Guitar/bass: pixels of vertical drag per semitone, and how far to move before transposing at all. */
const FRET_STEP_PX = 10;
const FRET_DEAD_ZONE_PX = 6;

/** Whole steps covered by a drag distance, after a dead zone; signed. */
function dragSteps(px: number, deadZone: number, stepPx: number): number {
  const dist = Math.abs(px);
  return dist <= deadZone ? 0 : Math.sign(px) * (1 + Math.floor((dist - deadZone) / stepPx));
}

export function Timeline({ song, ed, peers }: Props) {
  const track = song.tracks[ed.trackId];
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const notes = useMemo(
    () => Object.values(song.notes).filter((n) => n.trackId === ed.trackId),
    [song.notes, ed.trackId],
  );

  const step = stepTicks();
  const bar = barTicks(song.meta);
  const beat = beatTicks(song.meta);
  const rowTicks = ed.barsPerRow * bar;
  const lastEnd = notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
  // Room after the last note (and the cursor) to keep writing, rounded up to whole rows.
  const bars = Math.max(8, Math.ceil(Math.max(lastEnd, ed.cursor + step) / bar) + 1);
  const rows = Math.max(1, Math.ceil(bars / ed.barsPerRow));
  const gutter = GUTTER[track?.kind ?? 'guitar'];
  const width = Math.max(200, ed.rowWidth);
  /** Pixels per tick: each row stretches across the timeline. */
  const ppt = (width - gutter - RIGHT_PAD) / rowTicks;
  const piano = track?.kind === 'piano';
  const stringed = track ? isStringed(track.kind) : true;
  const rowH = piano ? PIANO_ROW_H : ROW_H;
  const chipH = piano ? PIANO_CHIP_H : CHIP_H;

  /**
   * What a drag does to the grabbed notes: horizontal = time (snapped to the grid); vertical = pitch.
   * Piano rows are semitones and drum rows are kit pieces, so vertical moves across lanes; on guitar
   * and bass notes stay on their strings and the fret changes. Clamped so the group keeps its shape.
   */
  const dragShift = (d: Drag): NoteShift => {
    const ticks = Math.round(d.dx / ppt / step) * step;
    const up = -d.dy;
    const shift = stringed
      ? { ticks, lanes: 0, frets: dragSteps(up, FRET_DEAD_ZONE_PX, FRET_STEP_PX) }
      : { ticks, lanes: -dragSteps(up, rowH / 2, rowH), frets: 0 };
    return clampShift(song, d.ids, shift);
  };
  const shift: NoteShift = drag ? dragShift(drag) : { ticks: 0, lanes: 0, frets: 0 };
  const dragging = new Set(drag?.ids ?? []);

  const [laneStart, laneCount] = useMemo(
    () =>
      visibleLanes(track?.kind ?? 'guitar', track?.tuning.length ?? 6, [
        ...notes.map((n) => n.string + (dragging.has(n.id) ? shift.lanes : 0)),
        ed.cursorString,
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [track?.kind, track?.tuning.length, notes, ed.cursorString, drag ? shift.lanes : 0],
  );
  const lanes = Array.from({ length: laneCount }, (_, i) => laneStart + i);
  const inView = (lane: number) => lane >= laneStart && lane < laneStart + laneCount;
  /** Height of one row (ruler + lanes), and the distance from one row's top to the next. */
  const rowBody = RULER_H + PAD * 2 + laneCount * rowH;
  const stride = rowBody + ROW_GAP;
  const height = rows * stride - ROW_GAP;
  const rowTop = (r: number) => r * stride;
  const rowOf = (tick: number) => Math.floor(tick / rowTicks);
  /** Where a tick sits: its row and x within that row. */
  const at = (tick: number) => {
    const r = rowOf(tick);
    return { r, x: gutter + (tick - r * rowTicks) * ppt };
  };
  const laneY = (r: number, lane: number) => rowTop(r) + RULER_H + PAD + (lane - laneStart) * rowH + rowH / 2;
  /**
   * On-screen boxes of a note chip: one per row it crosses (a note can run past the end of a row).
   * Shared by rendering and box selection.
   */
  const chipRects = (n: Note, start = n.start, lane = n.string) => {
    const out: { r: number; x: number; w: number; y: number; first: boolean }[] = [];
    const end = start + n.duration;
    for (let t = start; t < end; ) {
      const r = rowOf(t);
      const segEnd = Math.min(end, (r + 1) * rowTicks);
      const first = t === start;
      const last = segEnd === end;
      const x = gutter + (t - r * rowTicks) * ppt + (first ? 1 : 0);
      let w = (segEnd - t) * ppt - (first ? 1 : 0) - (last ? 1 : 0);
      if (first && last) w = Math.max(w, piano ? 6 : 14);
      out.push({ r, x, w, y: laneY(r, lane) - chipH / 2, first });
      t = segEnd;
    }
    return out;
  };
  /** Point in the svg → row, tick (unsnapped) and lane (null over the ruler or margins). */
  const hit = (x: number, y: number) => {
    const r = Math.min(rows - 1, Math.max(0, Math.floor(y / stride)));
    const local = y - rowTop(r);
    const tick = r * rowTicks + Math.min(rowTicks - 1, Math.max(0, (x - gutter) / ppt));
    const lane = laneStart + Math.floor((local - RULER_H - PAD) / rowH);
    const onLane = local >= RULER_H + PAD && local < rowBody - PAD && inView(lane);
    return { r, tick, lane: onLane ? lane : null };
  };
  const [marquee, setMarquee] = useState<{ x0: number; x1: number; y0: number; y1: number } | null>(null);

  const selected = new Set(ed.selection);

  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const shiftRef = useRef(dragShift);
  shiftRef.current = dragShift;
  // Pitch offset last auditioned during this drag, so each new pitch sounds once.
  const auditionedRef = useRef(0);

  useEffect(() => {
    if (!drag) return;
    auditionedRef.current = 0;
    const onMove = (e: MouseEvent) => {
      setDrag((d) => d && { ...d, dx: e.clientX - d.x0, dy: e.clientY - d.y0 });
      const d = dragRef.current;
      const n = d && song.notes[d.anchor];
      const t = n && song.tracks[n.trackId];
      if (!d || !n || !t) return;
      const s = shiftRef.current({ ...d, dx: e.clientX - d.x0, dy: e.clientY - d.y0 });
      const offset = s.lanes || s.frets;
      if (offset !== auditionedRef.current) {
        auditionedRef.current = offset;
        audition(t.id, t.tuning[n.string + s.lanes] + n.fret + s.frets);
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d) shiftSelection(shiftRef.current(d));
      setDrag(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag !== null, ppt, step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Measure the timeline so rows can fill its width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w > 0 && w !== editor.get().rowWidth) editor.set({ rowWidth: w });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!track]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the cursor's (or, while playing, the playhead's) row in view.
  const focus = ed.playhead ?? ed.cursor;
  const focusRow = rowOf(focus);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = rowTop(focusRow);
    const bottom = top + rowBody;
    if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) {
      // While playing, turn the page so the current row is at the top; otherwise just bring it into view.
      el.scrollTo({
        top: ed.playing || top < el.scrollTop ? top : bottom - el.clientHeight,
        behavior: ed.playing ? 'smooth' : 'auto',
      });
    }
  }, [focusRow, stride]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!track) return null;
  const isDrums = track.kind === 'drums';
  const clickToAdd = !isStringed(track.kind);

  const onBackgroundDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const svg = svgRef.current!;
    const toSvg = (ev: { clientX: number; clientY: number }) => {
      const r = svg.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    const { x, y } = toSvg(e);
    const h = hit(x, y);
    const tick = Math.max(0, Math.floor(h.tick / step) * step);
    const s = h.lane;
    const base = e.shiftKey ? editor.get().selection : [];
    editor.set((st) => ({
      cursor: tick,
      cursorString: s ?? st.cursorString,
      selection: base,
    }));

    // Dragging from empty space draws a selection box; anything it touches is selected.
    let active = false;
    const onMove = (ev: MouseEvent) => {
      const p = toSvg(ev);
      if (!active && Math.hypot(p.x - x, p.y - y) < 4) return;
      active = true;
      const box = { x0: Math.min(x, p.x), x1: Math.max(x, p.x), y0: Math.min(y, p.y), y1: Math.max(y, p.y) };
      setMarquee(box);
      const hits = notes
        .filter((n) =>
          chipRects(n).some((c) => c.x < box.x1 && c.x + c.w > box.x0 && c.y < box.y1 && c.y + chipH > box.y0),
        )
        .map((n) => n.id);
      editor.set({ selection: [...new Set([...base, ...hits])] });
    };
    const onUp = () => {
      setMarquee(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Drums and piano work like a step sequencer / piano roll: a plain click on an empty cell adds a note.
      if (!active && clickToAdd && !e.shiftKey && s !== null) placeNote(s, 0, { advance: false });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onNoteDown = (e: React.MouseEvent, id: ID) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = editor.get();
    let selection: ID[];
    if (e.shiftKey) {
      selection = st.selection.includes(id) ? st.selection.filter((x) => x !== id) : [...st.selection, id];
    } else {
      selection = st.selection.includes(id) ? st.selection : [id];
    }
    const n = song.notes[id];
    editor.set({ selection, cursorString: n.string });
    if (selection.includes(id)) setDrag({ ids: selection, anchor: id, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 });
  };

  const rowIndexes = Array.from({ length: rows }, (_, r) => r);
  const visibleRow = (r: number) => r >= 0 && r < rows;

  /** One row's background: ruler, lane labels, lane lines and grid. */
  const renderRow = (r: number) => {
    const top = rowTop(r);
    const right = width - RIGHT_PAD;
    const lines: JSX.Element[] = [];
    for (let t = 0; t <= rowTicks; t += step) {
      if (t % beat === 0) continue;
      const x = gutter + t * ppt;
      lines.push(<line key={`g${t}`} x1={x} x2={x} y1={top + RULER_H} y2={top + rowBody} className="tl-grid" />);
    }
    for (let t = 0; t <= rowTicks; t += beat) {
      const x = gutter + t * ppt;
      const isBar = t % bar === 0;
      lines.push(
        <line
          key={`b${t}`}
          x1={x}
          x2={x}
          y1={isBar ? top : top + RULER_H - 6}
          y2={top + rowBody}
          className={isBar ? 'tl-bar' : 'tl-beat'}
        />,
      );
    }
    const labelX = isDrums ? 10 : piano ? gutter - 6 : gutter / 2;
    return (
      <g key={r} className="tl-row">
        <rect x={0} y={top} width={width} height={rowBody} className="tl-row-bg" />
        <rect x={gutter} y={top} width={right - gutter} height={RULER_H} className="tl-ruler" />
        {Array.from({ length: ed.barsPerRow }, (_, i) => (
          <text key={i} x={gutter + i * bar * ppt + 5} y={top + 15} className="tl-barnum">
            {r * ed.barsPerRow + i + 1}
          </text>
        ))}
        <rect x={0} y={top} width={gutter} height={rowBody} className="tl-gutter-bg" />
        {piano
          ? lanes.map((s) => (
              <g key={s}>
                {isBlackKey(track.tuning[s]) && (
                  <rect x={0} y={laneY(r, s) - rowH / 2} width={right} height={rowH} className="tl-blackkey" />
                )}
                {track.tuning[s] % 12 === 0 && (
                  <line x1={0} x2={right} y1={laneY(r, s) + rowH / 2} y2={laneY(r, s) + rowH / 2} className="tl-octave" />
                )}
              </g>
            ))
          : lanes.map((s) => (
              <line key={s} x1={gutter} x2={right} y1={laneY(r, s)} y2={laneY(r, s)} className="tl-string" />
            ))}
        {lines}
        {lanes.map((s) => (
          <text
            key={`l${s}`}
            x={labelX}
            y={laneY(r, s)}
            className={[
              'tl-lane',
              track.kind,
              s === ed.cursorString ? 'active' : '',
              piano && track.tuning[s] % 12 === 0 ? 'octave' : '',
            ].join(' ')}
          >
            {laneLabel(track, s)}
          </text>
        ))}
        <line x1={gutter} x2={gutter} y1={top} y2={top + rowBody} className="tl-gutter-edge" />
      </g>
    );
  };

  /** A vertical marker (cursor, playhead, peer) at a tick, spanning that tick's row. */
  const marker = (tick: number) => {
    const { r, x } = at(tick);
    return { r, x, y1: rowTop(r), y2: rowTop(r) + rowBody };
  };
  const cursorAt = marker(ed.cursor);
  const playAt = ed.playhead !== null ? marker(ed.playhead) : null;

  return (
    <div className="timeline">
      <div className="tl-scroll" ref={scrollRef}>
        <svg ref={svgRef} width={width} height={height} onMouseDown={onBackgroundDown}>
          {rowIndexes.map(renderRow)}

          {visibleRow(cursorAt.r) && (
            <rect
              x={cursorAt.x}
              y={laneY(cursorAt.r, ed.cursorString) - rowH / 2}
              width={Math.max(step * ppt, 6)}
              height={rowH}
              className="tl-cursor-cell"
            />
          )}

          {notes.map((n) => {
            const moving = dragging.has(n.id);
            const start = moving ? Math.max(0, n.start + shift.ticks) : n.start;
            const lane = moving ? n.string + shift.lanes : n.string;
            const fret = moving ? n.fret + shift.frets : n.fret;
            const triplet = describeDuration(n.duration)?.triplet;
            const color = piano ? 'piano' : `s${lane % 8}`;
            const cls = ['tl-note', color, selected.has(n.id) ? 'selected' : '', moving ? 'dragging' : ''].join(' ');
            const label = piano ? pitchName(track.tuning[lane]) : isDrums ? (isCymbal(track.tuning[lane]) ? '×' : '●') : fret;
            return (
              <g key={n.id} className={cls} onMouseDown={(e) => onNoteDown(e, n.id)}>
                {chipRects(n, start, lane).map(({ r, x, w, y, first }) => (
                  <g key={r} className={first ? '' : 'continued'}>
                    <rect x={x} y={y} width={w} height={chipH} rx={piano ? 2 : 4} />
                    {first && (!piano || w >= 30) && (
                      <text
                        x={x + (piano ? 3 : 5)}
                        y={y + (piano ? 9.5 : 14)}
                        className={piano ? 'tl-fret small' : 'tl-fret'}
                      >
                        {label}
                      </text>
                    )}
                    {first && triplet && w > 22 && !piano && (
                      <text x={x + w - 4} y={y + 8} className="tl-tuplet">
                        3
                      </text>
                    )}
                  </g>
                ))}
              </g>
            );
          })}

          {peers
            .filter((p) => p.trackId === ed.trackId && inView(p.string))
            .map((p) => {
              const m = marker(p.cursor);
              if (!visibleRow(m.r)) return null;
              return (
                <g key={p.actor} pointerEvents="none">
                  <line x1={m.x} x2={m.x} y1={m.y1 + RULER_H} y2={m.y2} stroke={p.color} strokeWidth={2} />
                  <rect
                    x={m.x}
                    y={laneY(m.r, p.string) - rowH / 2}
                    width={step * ppt}
                    height={rowH}
                    fill={p.color}
                    opacity={0.15}
                  />
                  <text x={m.x + 4} y={m.y1 + RULER_H + 10} fill={p.color} className="tl-peer">
                    {p.name}
                  </text>
                </g>
              );
            })}

          {visibleRow(cursorAt.r) && (
            <line x1={cursorAt.x} x2={cursorAt.x} y1={cursorAt.y1} y2={cursorAt.y2} className="tl-cursor" />
          )}
          {playAt && visibleRow(playAt.r) && (
            <line x1={playAt.x} x2={playAt.x} y1={playAt.y1} y2={playAt.y2} className="tl-playhead" />
          )}
          {marquee && (
            <rect
              x={marquee.x0}
              y={marquee.y0}
              width={marquee.x1 - marquee.x0}
              height={marquee.y1 - marquee.y0}
              className="tl-marquee"
              pointerEvents="none"
            />
          )}
        </svg>
      </div>
    </div>
  );
}
