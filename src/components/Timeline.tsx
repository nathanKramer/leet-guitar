import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorState } from '../editor/editorStore';
import { rowLayout } from '../editor/rows';
import { audition, placeNote, previewNote, shiftSelection, stepTicks } from '../editor/actions';
import { describeDuration } from '../model/durations';
import { meter, sigLabel } from '../model/meter';
import { isCymbal, laneLabel } from '../model/drums';
import { isStringed } from '../model/instruments';
import { visibleLanes } from '../model/lanes';
import { isBlackKey, pitchName } from '../model/music';
import { clampShift, resizedDurations, resizeNotes, type NoteShift } from '../model/commands';
import type { ID, Note, Song } from '../model/types';
import { docStore, editor } from '../session';
import type { PeerState } from '../sync/awareness';

/** The bar-number strip at the top of each row; clicking it moves the cursor (where playback starts). */
const RULER_H = 30;
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
/** Guitar/bass: band above the strings for palm-mute markings, like the "P.M." line in tab. */
const MARKS_H = 13;

interface Props {
  song: Song;
  ed: EditorState;
  peers: PeerState[];
}

interface Drag {
  ids: ID[];
  /** The note that was grabbed; it's auditioned as the pitch changes. */
  anchor: ID;
  /** Pixels per tick in the row where the drag started. */
  ppt: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
}

/** Dragging a note's right edge: the notes being resized and where the grabbed note now ends. */
interface Resize {
  ids: ID[];
  anchor: ID;
  end: number;
}

/** Width of the grab zone at a note's right edge (narrower on short notes, so the body stays grabbable). */
const EDGE_PX = 6;

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
  const [resize, setResize] = useState<Resize | null>(null);
  /** Row whose ruler is pinned to the top of the view (its own ruler has scrolled out of sight), if any. */
  const [stuck, setStuck] = useState<number | null>(null);
  const stickyRef = useRef<HTMLDivElement>(null);

  const notes = useMemo(
    () => Object.values(song.notes).filter((n) => n.trackId === ed.trackId),
    [song.notes, ed.trackId],
  );

  const step = stepTicks();
  const m = meter(song);
  const bpr = ed.barsPerRow;
  const lastEnd = notes.reduce((mx, n) => Math.max(mx, n.start + n.duration), 0);
  // Room after the last note (and the cursor) to keep writing, rounded up to whole rows.
  const bars = Math.max(8, m.barAt(Math.max(lastEnd, ed.cursor + step) - 1) + 2);
  const layout = rowLayout(m, bpr);
  const rows = Math.max(1, layout.count(bars));
  const gutter = GUTTER[track?.kind ?? 'guitar'];
  const width = Math.max(200, ed.rowWidth);
  /** Where a row starts and ends, in ticks. Rows hold the same share of bars, but bars can differ in length. */
  const rowStart = layout.start;
  const rowEnd = layout.end;
  /** Pixels per tick in a row: each row stretches across the timeline. */
  const pptOf = (r: number) => (width - gutter - RIGHT_PAD) / (rowEnd(r) - rowStart(r));
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
    const ticks = Math.round(d.dx / d.ppt / step) * step;
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
  /** Top of the first lane within a row. */
  const lanesTop = RULER_H + PAD + (stringed ? MARKS_H : 0);
  const rowBody = lanesTop + PAD + laneCount * rowH;
  const stride = rowBody + ROW_GAP;
  const height = rows * stride - ROW_GAP;
  const rowTop = (r: number) => r * stride;
  const rowOf = layout.of;
  /** x of a tick within row `r`. */
  const xIn = (r: number, tick: number) => gutter + (tick - rowStart(r)) * pptOf(r);
  /** Where a tick sits: its row and x within that row. */
  const at = (tick: number) => {
    const r = rowOf(tick);
    return { r, x: xIn(r, tick) };
  };
  const laneY = (r: number, lane: number) => rowTop(r) + lanesTop + (lane - laneStart) * rowH + rowH / 2;
  /**
   * On-screen boxes of a note chip: one per row it crosses (a note can run past the end of a row).
   * Shared by rendering and box selection.
   */
  const chipRects = (n: Note, start = n.start, lane = n.string) => {
    const out: { r: number; x: number; w: number; y: number; first: boolean; last: boolean }[] = [];
    const end = start + n.duration;
    for (let t = start; t < end;) {
      const r = rowOf(t);
      const segEnd = Math.min(end, rowEnd(r));
      const first = t === start;
      const last = segEnd === end;
      const x = xIn(r, t) + (first ? 1 : 0);
      let w = (segEnd - t) * pptOf(r) - (first ? 1 : 0) - (last ? 1 : 0);
      if (first && last) w = Math.max(w, piano ? 6 : 14);
      out.push({ r, x, w, y: laneY(r, lane) - chipH / 2, first, last });
      t = segEnd;
    }
    return out;
  };
  /** Point in the svg → row, tick (unsnapped) and lane (null over the ruler or margins). */
  const hit = (x: number, y: number) => {
    const r = Math.min(rows - 1, Math.max(0, Math.floor(y / stride)));
    const local = y - rowTop(r);
    const tick = rowStart(r) + Math.min(rowEnd(r) - rowStart(r) - 1, Math.max(0, (x - gutter) / pptOf(r)));
    const lane = laneStart + Math.floor((local - lanesTop) / rowH);
    const onLane = local >= lanesTop && local < rowBody - PAD && inView(lane);
    return { r, tick, lane: onLane ? lane : null };
  };
  /** How far the grabbed note's end has moved; every resized note changes by the same amount. */
  const resizeDelta = (rs: Resize) => {
    const n = song.notes[rs.anchor];
    return n ? rs.end - (n.start + n.duration) : 0;
  };
  const resized = useMemo(
    () => (resize ? resizedDurations(song, resize.ids, resizeDelta(resize), step) : new Map<ID, number>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resize, song.notes, step],
  );
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
      if (d) {
        shiftSelection(shiftRef.current(d));
        // Follow the grabbed note to where it landed.
        const moved = docStore.getSong().notes[d.anchor];
        if (moved) editor.set({ cursor: moved.start, cursorString: moved.string });
      }
      setDrag(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag !== null, step]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Pin the ruler of the row at the top of the view, so it can be clicked from anywhere in that row. As the next
  // row's ruler comes up, it pushes the pinned one out of the way.
  const pinRuler = () => {
    const el = scrollRef.current;
    if (!el) return;
    const y = el.scrollTop;
    const r = Math.min(rows - 1, Math.floor(y / stride));
    const pinned = y > rowTop(r) && y < rowTop(r) + rowBody - RULER_H ? r : null;
    setStuck(pinned);
    if (stickyRef.current) {
      const push = pinned === null ? 0 : Math.min(0, rowTop(r) + rowBody - y - RULER_H);
      stickyRef.current.style.transform = `translateY(${push}px)`;
    }
  };
  useEffect(pinRuler, [stride, rows]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const tick = m.snap(h.tick, step);
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

  /** Clicking a row's ruler moves the cursor there; dragging along it scrubs. */
  const onRulerDown = (e: React.MouseEvent, r: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const left = (e.currentTarget as Element).closest('svg')!.getBoundingClientRect().left;
    const seek = (ev: { clientX: number }) => {
      const x = ev.clientX - left;
      const tick = rowStart(r) + Math.min(rowEnd(r) - rowStart(r) - 1, Math.max(0, (x - gutter) / pptOf(r)));
      const cursor = m.snap(tick, step);
      if (cursor !== editor.get().cursor) editor.set({ cursor });
    };
    seek(e);
    const onUp = () => {
      window.removeEventListener('mousemove', seek);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', seek);
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
    // Selecting a note puts the cursor on it, so the fretboard / keyboard shows it.
    editor.set(selection.includes(id) ? { selection, cursor: n.start, cursorString: n.string } : { selection });
    if (selection.includes(id)) previewNote(id);
    if (selection.includes(id)) {
      setDrag({ ids: selection, anchor: id, ppt: pptOf(rowOf(n.start)), x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 });
    }
  };

  /**
   * Grabbing a note's right edge sets its length: the end snaps to the grid. If the note is selected, every
   * selected note grows or shrinks by the same amount.
   */
  const onEdgeDown = (e: React.MouseEvent, id: ID) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = editor.get();
    const ids = st.selection.includes(id) ? st.selection : [id];
    const n = song.notes[id];
    editor.set({ selection: ids, cursor: n.start, cursorString: n.string });
    const svg = svgRef.current!;
    const endAt = (ev: { clientX: number; clientY: number }) => {
      const rect = svg.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      // Past the right edge of a row means the end of that row (the start of the next).
      const r = Math.min(rows - 1, Math.max(0, Math.floor(y / stride)));
      const tick = rowStart(r) + Math.min(rowEnd(r) - rowStart(r), Math.max(0, (x - gutter) / pptOf(r)));
      return tick >= rowEnd(r) ? rowEnd(r) : m.round(tick, step);
    };
    let current: Resize = { ids, anchor: id, end: n.start + n.duration };
    setResize(current);
    const onMove = (ev: MouseEvent) => {
      const end = endAt(ev);
      if (end !== current.end) setResize((current = { ...current, end }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const s = docStore.getSong();
      const anchor = s.notes[id];
      if (anchor) {
        const ops = resizeNotes(s, ids, current.end - (anchor.start + anchor.duration), step);
        if (ops.length) docStore.transact(ops);
      }
      setResize(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const rowIndexes = Array.from({ length: rows }, (_, r) => r);
  const visibleRow = (r: number) => r >= 0 && r < rows;

  /**
   * A row's ruler: bar numbers and beat ticks, drawn at `top`. Used in the row itself and, pinned, at the top of
   * the view.
   */
  const renderRuler = (r: number, top: number) => {
    const right = width - RIGHT_PAD;
    const from = rowStart(r);
    const to = rowEnd(r);
    const firstBar = m.barAt(from);
    const lastBar = m.barAt(to - 1);
    const ticks: JSX.Element[] = [];
    for (let b = firstBar; b <= lastBar; b++) {
      const start = m.barStart(b);
      const beat = m.beatTicks(b);
      for (let t = 0; t < m.barLength(b); t += beat) {
        if (start + t < from || start + t >= to) continue;
        const x = xIn(r, start + t);
        const isBar = t === 0;
        ticks.push(
          <line
            key={`${b}:${t}`}
            x1={x}
            x2={x}
            y1={isBar ? top : top + RULER_H - 7}
            y2={top + RULER_H}
            className={isBar ? 'tl-ruler-bar' : 'tl-ruler-beat'}
          />,
        );
      }
    }
    return (
      <g className="tl-ruler-strip" onMouseDown={(e) => onRulerDown(e, r)}>
        <rect x={gutter} y={top} width={right - gutter} height={RULER_H} className="tl-ruler" />
        {ticks}
        {Array.from({ length: lastBar - firstBar + 1 }, (_, i) => {
          const b = firstBar + i;
          const barStart = m.barStart(b);
          // A row that starts partway through a bar still names the bar, with which beat it picks up from.
          const partial = barStart < from;
          const x = xIn(r, Math.max(barStart, from));
          return (
            <text key={i} x={x + 6} y={top + RULER_H / 2} className="tl-barnum">
              {b + 1}
              {partial && <tspan className="tl-timesig">{` beat ${Math.floor((from - barStart) / m.beatTicks(b)) + 1}`}</tspan>}
              {!partial && m.changesAt(b) && <tspan className="tl-timesig">{` ${sigLabel(m.sigAt(b))}`}</tspan>}
            </text>
          );
        })}
        <line x1={gutter} x2={right} y1={top + RULER_H - 0.5} y2={top + RULER_H - 0.5} className="tl-ruler-edge" />
      </g>
    );
  };

  /** A marker's head in the ruler (cursor or playhead), so the play position reads at a glance. */
  const rulerHead = (x: number, top: number, cls: string) => (
    <path d={`M${x - 5},${top} h10 v5 l-5,5 l-5,-5 z`} className={cls} pointerEvents="none" />
  );

  /** One row's background: ruler, lane labels, lane lines and grid. */
  const renderRow = (r: number) => {
    const top = rowTop(r);
    const right = width - RIGHT_PAD;
    const lines: JSX.Element[] = [];
    const barLines = (x: number, key: string, isBar: boolean) => (
      <line
        key={key}
        x1={x}
        x2={x}
        y1={isBar ? top : top + RULER_H - 6}
        y2={top + rowBody}
        className={isBar ? 'tl-bar' : 'tl-beat'}
      />
    );
    // Each bar has its own grid, measured from its start (bars can differ in length). Below one bar per row, a row
    // holds only part of a bar, so only that part's lines are drawn.
    const from = rowStart(r);
    const to = rowEnd(r);
    const inRow = (tick: number) => tick >= from && tick < to;
    const firstBar = m.barAt(from);
    const lastBar = m.barAt(to - 1);
    for (let b = firstBar; b <= lastBar; b++) {
      const start = m.barStart(b);
      const len = m.barLength(b);
      const beat = m.beatTicks(b);
      for (let t = step; t < len; t += step) {
        if (t % beat === 0 || !inRow(start + t)) continue;
        const x = xIn(r, start + t);
        lines.push(<line key={`g${b}:${t}`} x1={x} x2={x} y1={top + RULER_H} y2={top + rowBody} className="tl-grid" />);
      }
      for (let t = 0; t < len; t += beat) {
        if (inRow(start + t)) lines.push(barLines(xIn(r, start + t), `b${b}:${t}`, t === 0));
      }
    }
    lines.push(barLines(right, 'end', true));
    const labelX = isDrums ? 10 : piano ? gutter - 6 : gutter / 2;
    return (
      <g key={r} className="tl-row">
        <rect x={0} y={top} width={width} height={rowBody} className="tl-row-bg" />
        <rect x={0} y={top} width={gutter} height={rowBody} className="tl-gutter-bg" />
        {piano
          ? lanes.map((s) => (
              <g key={s}>
                {isBlackKey(track.tuning[s]) && (
                  <rect x={0} y={laneY(r, s) - rowH / 2} width={right} height={rowH} className="tl-blackkey" />
                )}
                {track.tuning[s] % 12 === 0 && (
                  <line
                    x1={0}
                    x2={right}
                    y1={laneY(r, s) + rowH / 2}
                    y2={laneY(r, s) + rowH / 2}
                    className="tl-octave"
                  />
                )}
              </g>
            ))
          : lanes.map((s) => (
              <line key={s} x1={gutter} x2={right} y1={laneY(r, s)} y2={laneY(r, s)} className="tl-string" />
            ))}
        {lines}
        {renderRuler(r, top)}
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

  /**
   * Palm-mute markings: one "P.M. - - -|" span per run of palm-muted notes that follow on without a gap
   * (chords count once), split where a run crosses into the next row.
   */
  const palmMuteSpans = (() => {
    if (!stringed) return [];
    const muted = notes
      .filter((n) => n.palmMute)
      .map((n) => {
        const start = dragging.has(n.id) ? Math.max(0, n.start + shift.ticks) : n.start;
        return { start, end: start + n.duration };
      })
      .sort((a, b) => a.start - b.start);
    const runs: { start: number; end: number }[] = [];
    for (const m of muted) {
      const last = runs[runs.length - 1];
      if (last && m.start <= last.end) last.end = Math.max(last.end, m.end);
      else runs.push({ ...m });
    }
    return runs.flatMap((run) => {
      const out: { key: string; r: number; x0: number; x1: number; first: boolean; last: boolean }[] = [];
      for (let t = run.start; t < run.end;) {
        const r = rowOf(t);
        const segEnd = Math.min(run.end, rowEnd(r));
        out.push({
          key: `${run.start}:${r}`,
          r,
          x0: xIn(r, t),
          x1: xIn(r, segEnd),
          first: t === run.start,
          last: segEnd === run.end,
        });
        t = segEnd;
      }
      return out;
    });
  })();

  /** A vertical marker (cursor, playhead, peer) at a tick, spanning that tick's row. */
  const marker = (tick: number) => {
    const { r, x } = at(tick);
    return { r, x, y1: rowTop(r), y2: rowTop(r) + rowBody };
  };
  const cursorAt = marker(ed.cursor);
  const playAt = ed.playhead !== null ? marker(ed.playhead) : null;

  return (
    <div className="timeline">
      <div className="tl-scroll" ref={scrollRef} onScroll={pinRuler}>
        <div className="tl-sticky" ref={stickyRef}>
          {stuck !== null && stuck < rows && (
            <svg width={width} height={RULER_H}>
              {renderRuler(stuck, 0)}
              {cursorAt.r === stuck && rulerHead(cursorAt.x, 0, 'tl-cursor-head')}
              {playAt && playAt.r === stuck && rulerHead(playAt.x, 0, 'tl-playhead-head')}
            </svg>
          )}
        </div>
        <svg ref={svgRef} width={width} height={height} onMouseDown={onBackgroundDown}>
          {rowIndexes.map(renderRow)}

          {visibleRow(cursorAt.r) && (
            <rect
              x={cursorAt.x}
              y={laneY(cursorAt.r, ed.cursorString) - rowH / 2}
              width={Math.max(step * pptOf(cursorAt.r), 6)}
              height={rowH}
              className="tl-cursor-cell"
            />
          )}

          {notes.map((n) => {
            const moving = dragging.has(n.id);
            const start = moving ? Math.max(0, n.start + shift.ticks) : n.start;
            const lane = moving ? n.string + shift.lanes : n.string;
            const fret = moving ? n.fret + shift.frets : n.fret;
            const sizing = resized.has(n.id);
            const shown = sizing ? { ...n, duration: resized.get(n.id)! } : n;
            const value = describeDuration(shown.duration);
            const color = piano ? 'piano' : `s${lane % 8}`;
            const cls = [
              'tl-note',
              color,
              selected.has(n.id) ? 'selected' : '',
              moving ? 'dragging' : '',
              sizing ? 'resizing' : '',
            ].join(' ');
            const label = piano
              ? pitchName(track.tuning[lane])
              : isDrums
                ? isCymbal(track.tuning[lane])
                  ? '×'
                  : '●'
                : fret;
            return (
              <g key={n.id} className={cls} onMouseDown={(e) => onNoteDown(e, n.id)}>
                {chipRects(shown, start, lane).map(({ r, x, w, y, first, last }) => (
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
                    {first && value?.triplet && w > 22 && !piano && (
                      <text x={x + w - 4} y={y + 8} className="tl-tuplet">
                        3
                      </text>
                    )}
                    {first && value?.dotted && w > 14 && (
                      <circle
                        cx={x + w - (piano ? 4 : 6)}
                        cy={y + chipH / 2}
                        r={piano ? 1.5 : 2.5}
                        className="tl-dot"
                      />
                    )}
                    {last && !moving && (
                      <rect
                        x={x + w - Math.min(EDGE_PX, w / 3)}
                        y={y}
                        width={Math.min(EDGE_PX, w / 3) + 2}
                        height={chipH}
                        className="tl-resize"
                        onMouseDown={(e) => onEdgeDown(e, n.id)}
                      >
                        <title>Drag to change the length</title>
                      </rect>
                    )}
                  </g>
                ))}
              </g>
            );
          })}

          {palmMuteSpans.map(({ key, r, x0, x1, first, last }) => {
            const y = rowTop(r) + RULER_H + PAD + MARKS_H / 2;
            const lineStart = first ? x0 + 26 : x0 + 2;
            return (
              <g key={key} className="tl-pm" pointerEvents="none">
                {first && (
                  <text x={x0 + 2} y={y}>
                    P.M.
                  </text>
                )}
                {x1 - 3 > lineStart && <line x1={lineStart} x2={x1 - 3} y1={y} y2={y} />}
                {last && <line x1={x1 - 3} x2={x1 - 3} y1={y - 4} y2={y + 4} className="tl-pm-end" />}
              </g>
            );
          })}

          {peers
            .filter((p) => p.trackId === ed.trackId && inView(p.string))
            .map((p) => {
              const pm = marker(p.cursor);
              if (!visibleRow(pm.r)) return null;
              return (
                <g key={p.actor} pointerEvents="none">
                  <line x1={pm.x} x2={pm.x} y1={pm.y1 + RULER_H} y2={pm.y2} stroke={p.color} strokeWidth={2} />
                  <rect
                    x={pm.x}
                    y={laneY(pm.r, p.string) - rowH / 2}
                    width={step * pptOf(pm.r)}
                    height={rowH}
                    fill={p.color}
                    opacity={0.15}
                  />
                  <text x={pm.x + 4} y={pm.y1 + RULER_H + 10} fill={p.color} className="tl-peer">
                    {p.name}
                  </text>
                </g>
              );
            })}

          {visibleRow(cursorAt.r) && (
            <>
              <line x1={cursorAt.x} x2={cursorAt.x} y1={cursorAt.y1} y2={cursorAt.y2} className="tl-cursor" />
              {rulerHead(cursorAt.x, cursorAt.y1, 'tl-cursor-head')}
            </>
          )}
          {playAt && visibleRow(playAt.r) && (
            <>
              <line x1={playAt.x} x2={playAt.x} y1={playAt.y1} y2={playAt.y2} className="tl-playhead" />
              {rulerHead(playAt.x, playAt.y1, 'tl-playhead-head')}
            </>
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
