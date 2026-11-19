export type TeacherDeskPosition = "LEFT" | "CENTER" | "RIGHT";

export type ClassroomDoorSide = "LEFT" | "RIGHT" | "NONE";

export type SeatingMapPrintPerspective = "ROOM" | "TEACHER";

export interface SeatingMapSeat {
  col: number;
  row: number;
  studentId: string | null;
  blocked?: boolean;
}

export interface SeatingMapVersion {
  id: string;
  name: string;
  effectiveDate: string | null;
  columns: number;
  rows: number;
  teacherDeskPosition: TeacherDeskPosition;
  doorSide: ClassroomDoorSide;
  notes: string | null;
  seats: SeatingMapSeat[];
  createdAt: string;
  updatedAt: string;
}

export interface SeatingMapStore {
  version: 1;
  activeMapId: string | null;
  maps: SeatingMapVersion[];
}

export interface SeatingGridCellView {
  seat: SeatingMapSeat;
  logicalCol: number;
  logicalRow: number;
  positionLabel: string;
}

export interface SeatingDisplayGrid {
  colIndices: number[];
  rowIndices: number[];
  rowsGrid: SeatingGridCellView[][];
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function normalizeSeatList(columns: number, rows: number, rawSeats: SeatingMapSeat[]): SeatingMapSeat[] {
  const byCoord = new Map<string, SeatingMapSeat>();
  const seenStudents = new Set<string>();

  for (const s of rawSeats) {
    if (
      !s ||
      typeof s !== "object" ||
      typeof s.col !== "number" ||
      typeof s.row !== "number" ||
      s.col < 0 ||
      s.col >= columns ||
      s.row < 0 ||
      s.row >= rows
    ) {
      continue;
    }
    const key = `${s.col}:${s.row}`;
    if (byCoord.has(key)) continue;

    const blocked = Boolean(s.blocked);
    let studentId = !blocked && typeof s.studentId === "string" && s.studentId.trim() ? s.studentId.trim() : null;
    if (studentId) {
      if (seenStudents.has(studentId)) {
        studentId = null;
      } else {
        seenStudents.add(studentId);
      }
    }

    byCoord.set(key, {
      col: s.col,
      row: s.row,
      studentId,
      ...(blocked ? { blocked: true } : {}),
    });
  }

  const normalized: SeatingMapSeat[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const existing = byCoord.get(`${col}:${row}`);
      normalized.push(
        existing ?? {
          col,
          row,
          studentId: null,
        }
      );
    }
  }
  return normalized;
}

export function parseSeatingMapStore(raw: string | null | undefined): SeatingMapStore {
  if (!raw || !raw.trim()) {
    return { version: 1, activeMapId: null, maps: [] };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { version: 1, activeMapId: null, maps: [] };
    }
    const obj = parsed as Record<string, unknown>;
    const rawMaps = Array.isArray(obj.maps) ? obj.maps : [];
    const maps: SeatingMapVersion[] = [];

    for (const item of rawMaps) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      const id = typeof m.id === "string" ? m.id.trim() : "";
      const name = typeof m.name === "string" ? m.name.trim() : "";
      if (!id || !name) continue;

      const columns = clampInt(typeof m.columns === "number" ? m.columns : 5, 2, 8);
      const rows = clampInt(typeof m.rows === "number" ? m.rows : 6, 1, 12);
      const teacherDeskPosition: TeacherDeskPosition =
        m.teacherDeskPosition === "LEFT" || m.teacherDeskPosition === "RIGHT"
          ? m.teacherDeskPosition
          : "CENTER";
      const doorSide: ClassroomDoorSide =
        m.doorSide === "RIGHT" || m.doorSide === "NONE" ? m.doorSide : "LEFT";

      const rawSeats = Array.isArray(m.seats) ? (m.seats as SeatingMapSeat[]) : [];
      const seats = normalizeSeatList(columns, rows, rawSeats);
      const nowIso = new Date().toISOString();

      maps.push({
        id,
        name,
        effectiveDate:
          typeof m.effectiveDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.effectiveDate.trim())
            ? m.effectiveDate.trim()
            : null,
        columns,
        rows,
        teacherDeskPosition,
        doorSide,
        notes: typeof m.notes === "string" && m.notes.trim() ? m.notes.trim() : null,
        seats,
        createdAt: typeof m.createdAt === "string" && m.createdAt.trim() ? m.createdAt : nowIso,
        updatedAt: typeof m.updatedAt === "string" && m.updatedAt.trim() ? m.updatedAt : nowIso,
      });
    }

    const activeMapId =
      typeof obj.activeMapId === "string" && maps.some((m) => m.id === obj.activeMapId)
        ? obj.activeMapId
        : maps[0]?.id ?? null;

    return {
      version: 1,
      activeMapId,
      maps,
    };
  } catch {
    return { version: 1, activeMapId: null, maps: [] };
  }
}

export function calculateRecommendedRows(activeStudentCount: number, columns: number): number {
  const safeCols = clampInt(columns, 2, 8);
  const safeStudents = Math.max(1, Math.trunc(activeStudentCount));
  return clampInt(Math.ceil(safeStudents / safeCols), 1, 12);
}

export function createSeatingMapVersion(params: {
  id: string;
  name: string;
  effectiveDate?: string | null;
  columns: number;
  rows: number;
  teacherDeskPosition?: TeacherDeskPosition;
  doorSide?: ClassroomDoorSide;
  notes?: string | null;
  nowIso?: string;
}): SeatingMapVersion {
  const columns = clampInt(params.columns, 2, 8);
  const rows = clampInt(params.rows, 1, 12);
  const now = params.nowIso || new Date().toISOString();

  return {
    id: params.id,
    name: params.name.trim() || "Mapa de sala",
    effectiveDate: params.effectiveDate ?? null,
    columns,
    rows,
    teacherDeskPosition: params.teacherDeskPosition ?? "CENTER",
    doorSide: params.doorSide ?? "LEFT",
    notes: params.notes?.trim() || null,
    seats: normalizeSeatList(columns, rows, []),
    createdAt: now,
    updatedAt: now,
  };
}

export function resizeSeatingMapGrid(
  map: SeatingMapVersion,
  nextColumnsRaw: number,
  nextRowsRaw: number,
  nowIso?: string
): { map: SeatingMapVersion; displacedStudentIds: string[] } {
  const nextColumns = clampInt(nextColumnsRaw, 2, 8);
  const nextRows = clampInt(nextRowsRaw, 1, 12);
  const now = nowIso || new Date().toISOString();

  const keptSeats: SeatingMapSeat[] = [];
  const overflowStudentIds: string[] = [];

  // Ordena por row/col para que realocações preservem prioridade da frente para o fundo
  const ordered = [...map.seats].sort((a, b) => a.row - b.row || a.col - b.col);
  for (const seat of ordered) {
    if (seat.col < nextColumns && seat.row < nextRows) {
      keptSeats.push({ ...seat });
    } else if (seat.studentId) {
      overflowStudentIds.push(seat.studentId);
    }
  }

  const nextSeats = normalizeSeatList(nextColumns, nextRows, keptSeats);
  const displacedStudentIds: string[] = [];

  for (const studentId of overflowStudentIds) {
    const freeSeat = nextSeats.find((s) => !s.blocked && s.studentId === null);
    if (freeSeat) {
      freeSeat.studentId = studentId;
    } else {
      displacedStudentIds.push(studentId);
    }
  }

  return {
    map: {
      ...map,
      columns: nextColumns,
      rows: nextRows,
      seats: nextSeats,
      updatedAt: now,
    },
    displacedStudentIds,
  };
}

export function assignStudentToSeat(
  map: SeatingMapVersion,
  col: number,
  row: number,
  studentId: string | null,
  nowIso?: string
): SeatingMapVersion {
  if (col < 0 || col >= map.columns || row < 0 || row >= map.rows) {
    return map;
  }
  const now = nowIso || new Date().toISOString();
  const cleanId = studentId && studentId.trim() ? studentId.trim() : null;

  const nextSeats = map.seats.map((seat) => {
    const isTarget = seat.col === col && seat.row === row;
    if (isTarget) {
      return {
        col: seat.col,
        row: seat.row,
        studentId: cleanId,
        ...(cleanId ? {} : seat.blocked ? { blocked: true } : {}),
      };
    }
    if (cleanId && seat.studentId === cleanId) {
      return {
        col: seat.col,
        row: seat.row,
        studentId: null,
        ...(seat.blocked ? { blocked: true } : {}),
      };
    }
    return { ...seat };
  });

  return {
    ...map,
    seats: normalizeSeatList(map.columns, map.rows, nextSeats),
    updatedAt: now,
  };
}

export function swapOrMoveSeats(
  map: SeatingMapVersion,
  from: { col: number; row: number },
  to: { col: number; row: number },
  nowIso?: string
): SeatingMapVersion {
  if (from.col === to.col && from.row === to.row) {
    return map;
  }
  const fromSeat = map.seats.find((s) => s.col === from.col && s.row === from.row);
  const toSeat = map.seats.find((s) => s.col === to.col && s.row === to.row);
  if (!fromSeat || !toSeat || toSeat.blocked) {
    return map;
  }
  if (!fromSeat.studentId && !toSeat.studentId) {
    return map;
  }

  const now = nowIso || new Date().toISOString();
  const fromStudent = fromSeat.studentId;
  const toStudent = toSeat.studentId;

  const nextSeats = map.seats.map((seat) => {
    if (seat.col === from.col && seat.row === from.row) {
      return {
        ...seat,
        studentId: toStudent,
      };
    }
    if (seat.col === to.col && seat.row === to.row) {
      return {
        ...seat,
        studentId: fromStudent,
      };
    }
    return { ...seat };
  });

  return {
    ...map,
    seats: normalizeSeatList(map.columns, map.rows, nextSeats),
    updatedAt: now,
  };
}

export function toggleSeatBlocked(
  map: SeatingMapVersion,
  col: number,
  row: number,
  nowIso?: string
): SeatingMapVersion {
  if (col < 0 || col >= map.columns || row < 0 || row >= map.rows) {
    return map;
  }
  const now = nowIso || new Date().toISOString();

  const nextSeats = map.seats.map((seat) => {
    if (seat.col !== col || seat.row !== row) return { ...seat };
    const nextBlocked = !seat.blocked;
    return {
      col: seat.col,
      row: seat.row,
      studentId: nextBlocked ? null : seat.studentId,
      ...(nextBlocked ? { blocked: true } : {}),
    };
  });

  return {
    ...map,
    seats: normalizeSeatList(map.columns, map.rows, nextSeats),
    updatedAt: now,
  };
}

export function fillSeatsAlphabetically(
  map: SeatingMapVersion,
  students: Array<{ studentId: string; name: string; enrollmentStatus?: string }>,
  nowIso?: string
): SeatingMapVersion {
  const now = nowIso || new Date().toISOString();
  const positioned = new Set(
    map.seats.map((s) => s.studentId).filter((id): id is string => Boolean(id))
  );

  const activePool = students.filter(
    (st) => st.enrollmentStatus === undefined || st.enrollmentStatus === "ATIVO"
  );
  const candidates = (activePool.length > 0 ? activePool : students)
    .filter((st) => !positioned.has(st.studentId))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  if (candidates.length === 0) {
    return map;
  }

  const nextSeats = normalizeSeatList(map.columns, map.rows, map.seats);
  let idx = 0;
  for (const seat of nextSeats) {
    if (idx >= candidates.length) break;
    if (!seat.blocked && seat.studentId === null) {
      seat.studentId = candidates[idx].studentId;
      idx += 1;
    }
  }

  return {
    ...map,
    seats: nextSeats,
    updatedAt: now,
  };
}

export function rotateSeatingMapColumns(
  map: SeatingMapVersion,
  direction: "RIGHT" | "LEFT" = "RIGHT",
  nowIso?: string
): SeatingMapVersion {
  const now = nowIso || new Date().toISOString();
  const delta = direction === "RIGHT" ? 1 : -1;

  const rotatedSeats = map.seats.map((seat) => ({
    ...seat,
    col: (seat.col + delta + map.columns) % map.columns,
  }));

  return {
    ...map,
    seats: normalizeSeatList(map.columns, map.rows, rotatedSeats),
    updatedAt: now,
  };
}

export function clearAllSeats(map: SeatingMapVersion, nowIso?: string): SeatingMapVersion {
  const now = nowIso || new Date().toISOString();
  return {
    ...map,
    seats: map.seats.map((seat) => ({
      col: seat.col,
      row: seat.row,
      studentId: null,
      ...(seat.blocked ? { blocked: true } : {}),
    })),
    updatedAt: now,
  };
}

export function duplicateMapVersion(
  source: SeatingMapVersion,
  options: {
    id: string;
    name: string;
    effectiveDate?: string | null;
    rotateDirection?: "RIGHT" | "LEFT" | null;
    nowIso?: string;
  }
): SeatingMapVersion {
  const now = options.nowIso || new Date().toISOString();
  const baseCopy: SeatingMapVersion = {
    ...source,
    id: options.id,
    name: options.name.trim() || `${source.name} (cópia)`,
    effectiveDate: options.effectiveDate ?? null,
    seats: source.seats.map((s) => ({ ...s })),
    createdAt: now,
    updatedAt: now,
  };

  if (options.rotateDirection) {
    return rotateSeatingMapColumns(baseCopy, options.rotateDirection, now);
  }
  return baseCopy;
}

export function getDisplayGridForPerspective(
  map: SeatingMapVersion,
  perspective: SeatingMapPrintPerspective
): SeatingDisplayGrid {
  const seatLookup = new Map<string, SeatingMapSeat>();
  for (const seat of map.seats) {
    seatLookup.set(`${seat.col}:${seat.row}`, seat);
  }

  const colIndices: number[] = [];
  const rowIndices: number[] = [];

  if (perspective === "ROOM") {
    for (let c = 0; c < map.columns; c += 1) colIndices.push(c);
    for (let r = 0; r < map.rows; r += 1) rowIndices.push(r);
  } else {
    for (let c = map.columns - 1; c >= 0; c -= 1) colIndices.push(c);
    for (let r = map.rows - 1; r >= 0; r -= 1) rowIndices.push(r);
  }

  const rowsGrid: SeatingGridCellView[][] = rowIndices.map((logicalRow) =>
    colIndices.map((logicalCol) => {
      const seat = seatLookup.get(`${logicalCol}:${logicalRow}`) ?? {
        col: logicalCol,
        row: logicalRow,
        studentId: null,
      };
      return {
        seat,
        logicalCol,
        logicalRow,
        positionLabel: `F${logicalCol + 1}·${logicalRow + 1}`,
      };
    })
  );

  return {
    colIndices,
    rowIndices,
    rowsGrid,
  };
}

export function getEffectiveTeacherDeskForPerspective(
  position: TeacherDeskPosition,
  perspective: SeatingMapPrintPerspective
): TeacherDeskPosition {
  if (perspective === "ROOM" || position === "CENTER") return position;
  return position === "LEFT" ? "RIGHT" : "LEFT";
}

export function getEffectiveDoorSideForPerspective(
  doorSide: ClassroomDoorSide,
  perspective: SeatingMapPrintPerspective
): ClassroomDoorSide {
  if (perspective === "ROOM" || doorSide === "NONE") return doorSide;
  return doorSide === "LEFT" ? "RIGHT" : "LEFT";
}

export function formatShortStudentName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return fullName.trim();
  if (parts.length === 2) return `${parts[0]} ${parts[1]}`;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}
