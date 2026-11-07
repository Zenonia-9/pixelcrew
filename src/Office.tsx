import { nearestActivityTarget } from "../shared/office-activity-target";
// Pixi's static shader/uniform implementation works under a CSP without unsafe-eval.
import "pixi.js/unsafe-eval";
import { drawOfficeArchitecture } from "./OfficeArchitecture";
import { spriteAsset, walkSpriteAsset } from "../shared/character-assets";
import { walkDirection, walkDirections, walkFrames, type WalkDirection } from "../shared/office-walk";
import { officeDesign } from "../shared/office-designs";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { OfficeViewport } from "./OfficeViewport";
import { clampCameraZoom } from "../shared/office-camera";
import { officeInteractions } from "../shared/office-interactions";
import { activeDividers, officeFixtures } from "../shared/office-rooms";
import { furnitureView } from "../shared/furniture-views";
import { officeActivity } from "../shared/office-status";
import { ROOM_WIDTH, ROOM_HEIGHT } from "../shared/room-dimensions";
import {
  MAX_OFFICE_ZOOM,
} from "../shared/office-zoom";
import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  TilingSprite,
} from "pixi.js";
// Blob workers are deliberately disallowed by the local UI's CSP. Pixi's
// worker capability probe can otherwise wait forever before loading textures.
Assets.setPreferences({ preferWorkers: false });
import {
  Focus,
  Minus,
  Plus,
  MessageCircle,
  Check,
  AlertTriangle,
  Maximize2,
  Minimize2,
  RotateCw,
  Pencil,
} from "lucide-react";
import type { Agent, CharacterState, Run, StudioEvent } from "../shared/types";
import {
  furniture,
  itemOffset,
  placeFurniture,
  furnitureBounds,
  transformFurniturePoint,
  roomItemPoint,
  resizeFurniture,
  type ResizeEdge,
  type RoomRotation,
  type RoomLayout,
} from "../shared/room-layout";
import {
  idleActivities,
  activityById,
  idleDelay,
  isOfficeBusy,
  updateJourneyClock,
  activityRemainingMs,
  journeyLabel,
  type JourneyClock,
  type IdleActivity,
} from "../shared/office-life";
import {
  stations,
  home,
  officePath,
  advancePath,
  type Point,
} from "../shared/office-motion";
export const station = (n: number): [number, number] => stations[n];
type Motion = JourneyClock & {
  kind: "social" | "task";
  position: Point;
  route: Point[];
  note: string;
  partner?: string;
  activity?: IdleActivity | "board" | "pin";
};
const label: Record<CharacterState, string> = {
  idle: "Ready",
  planning: "Making a plan",
  working: "At work",
  waiting: "Waiting for a handoff",
  approval: "Needs your approval",
  completed: "Work delivered",
  failed: "Needs attention",
  interrupted: "Taking a pause",
};
const frames: Record<CharacterState, number[]> = {
  idle: [0, 1],
  planning: [2, 3],
  working: [2, 3],
  waiting: [7],
  approval: [4],
  completed: [5],
  failed: [6],
  interrupted: [6],
};
export function Office(props: ComponentProps<typeof RpgOffice>) {
  return <RpgOffice {...props} />;
}
export function RpgOffice({
  viewControl,
  startEditing = false,
  agents,
  states,
  selected,
  onSelect,
  onBoard,
  unreadBoard = false,
  onApproval,
  reduced,
  run,
  events,
  progressByAgent = {},
  design = "timber",
  layout = {},
  onLayoutChange,
  completedRuns = [],
  onOpenTask,
  onViewChat,
}: {
  viewControl?: ReactNode;
  startEditing?: boolean;
  agents: Agent[];
  states: Record<string, CharacterState>;
  selected?: string;
  onSelect: (id: string) => void;
  onBoard: () => void;
  unreadBoard?: boolean;
  onApproval: (id: string) => void;
  reduced: boolean;
  run?: Run;
  events: StudioEvent[];
  progressByAgent?: Record<string, string>;
  completedRuns?: Run[];
  onOpenTask?: (run: Run) => void;
  onViewChat?: () => void;
  design?: string;
  layout?: RoomLayout;
  onLayoutChange?: (layout: RoomLayout) => Promise<boolean>;
}) {
  const [roomLayout, setRoomLayout] = useState(layout);
  const [arranging, setArranging] = useState(startEditing);
  const [selectedFurniture, setSelectedFurniture] = useState<string>();
  const layoutFurniture = [...furniture(agents), ...activeDividers(roomLayout), ...officeFixtures];
  const furnitureResize = useRef<
    | {
        id: string;
        edge: ResizeEdge;
        x: number;
        y: number;
        original: RoomLayout[string];
      }
    | undefined
  >(undefined);
  const selectedItem = layoutFurniture.find(
    (item) => item.id === selectedFurniture,
  );
  function rotateItem(id: string) {
    const item = layoutFurniture.find((item) => item.id === id);
    if (!item) return;
    const saved = latest.current.layout[id] || item;
    const rotation = (((latest.current.layout[id]?.rotation || 0) + 90) %
      360) as RoomRotation;
    const next = {
      ...latest.current.layout,
      [id]: placeFurniture(
        item,
        saved.x,
        saved.y,
        rotation,
        latest.current.layout[id]?.scale,
        {
          width: latest.current.layout[id]?.width,
          height: latest.current.layout[id]?.height,
        },
      ),
    };
    latest.current.layout = next;
    setRoomLayout(next);
    void saveLayout(next);
  }
  function resizeItem(direction: -1 | 1) {
    if (!selectedItem) return;
    const saved = latest.current.layout[selectedItem.id];
    const next = {
      ...latest.current.layout,
      [selectedItem.id]: placeFurniture(
        selectedItem,
        saved?.x ?? selectedItem.x,
        saved?.y ?? selectedItem.y,
        saved?.rotation,
        (saved?.scale ?? 1) + direction * 0.25,
        { width: saved?.width, height: saved?.height },
      ),
    };
    latest.current.layout = next;
    setRoomLayout(next);
    void saveLayout(next);
  }
  const [layoutSave, setLayoutSave] = useState("");
  const savingLayout = useRef(0);
  async function saveLayout(next: RoomLayout) {
    if (!onLayoutChange) return;
    const version = ++savingLayout.current;
    setLayoutSave("Saving…");
    try {
      const saved = await onLayoutChange(next);
      if (version === savingLayout.current)
        setLayoutSave(saved ? "Saved" : "Save failed — move again to retry");
    } catch {
      if (version === savingLayout.current)
        setLayoutSave("Save failed — move again to retry");
    }
  }
  const drag = useRef<
    { id: string; x: number; y: number; origin: Point } | undefined
  >(undefined);
  useEffect(() => {
    setRoomLayout(layout);
  }, [JSON.stringify(layout)]);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [motions, setMotions] = useState<Record<string, Motion>>({});
  const [completedAt, setCompletedAt] = useState<Record<string, number>>({});
  const previousStates = useRef({ runId: run?.id, states });
  useEffect(() => {
    const previous = previousStates.current;
    previousStates.current = { runId: run?.id, states };
    if (previous.runId !== run?.id) {
      setCompletedAt({});
      return;
    }
    const completed = Object.keys(states).filter(
      (id) => states[id] === "completed" && previous.states[id] !== "completed",
    );
    if (completed.length)
      setCompletedAt((current) => ({
        ...current,
        ...Object.fromEntries(completed.map((id) => [id, Date.now()])),
      }));
  }, [run?.id, JSON.stringify(states)]);
  useEffect(() => {
    const times = Object.values(completedAt);
    if (!times.length) return;
    const timer = setTimeout(
      () =>
        setCompletedAt((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([, at]) => Date.now() - at < 2500),
          ),
        ),
      Math.max(1, Math.min(...times) + 2500 - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [completedAt]);
  const motionRef = useRef(motions);
  const [expanded, setExpanded] = useState(false);
  const [partner, setPartner] = useState("");
  const [idleChoice, setIdleChoice] = useState<IdleActivity>("nap");
  const bedOccupied = Object.entries(motions).some(
    ([id, motion]) =>
      id !== selected &&
      motion.activity === "nap" &&
      motion.phase !== "returning",
  );
  const latest = useRef({
    agents,
    states,
    selected,
    reduced,
    motions,
    run,
    layout: roomLayout,
    completedAt,
  });
  latest.current = {
    agents,
    states,
    selected,
    reduced,
    motions,
    run,
    layout: roomLayout,
    completedAt,
  };
  useEffect(() => {
    motionRef.current = {};
    setMotions({});
  }, [JSON.stringify(roomLayout)]);
  const handoffQueue = useRef<NonNullable<StudioEvent["handoff"]>[]>([]);
  const seenEvent = useRef(Math.max(0, ...events.map((e) => e.seq)));
  useEffect(() => {
    handoffQueue.current = [];
    seenEvent.current = Math.max(0, ...events.map((event) => event.seq));
    motionRef.current = {};
    setMotions({});
  }, [run?.id]);
  useEffect(() => {
    if (run && ["cancelled", "interrupted", "failed"].includes(run.status)) {
      handoffQueue.current = [];
      motionRef.current = {};
      setMotions({});
    }
  }, [run?.status]);
  const [zoom, setZoom] = useState(1);
  const [cameraReset, setCameraReset] = useState(0);
  const autoFit = useRef(true);
  const fitOffice = () => {
    const viewport = host.current?.querySelector<HTMLElement>(".office-camera");
    const width = viewport?.clientWidth || host.current?.clientWidth || ROOM_WIDTH;
    const height = viewport?.clientHeight || (expanded ? window.innerHeight - 150 : 600);
    setZoom(Math.min(MAX_OFFICE_ZOOM, Math.max(0.3, Math.floor(Math.min(width / ROOM_WIDTH, height / ROOM_HEIGHT) * 10) / 10)));
  };
  useEffect(() => {
    const resize = () => {
      if (autoFit.current) fitOffice();
    };
    const observer = new ResizeObserver(resize);
    if (host.current) observer.observe(host.current);
    resize();
    return () => observer.disconnect();
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExpanded(false);
        expandButton.current?.focus();
      }
      if (e.key === "Tab" && host.current) {
        const buttons = Array.from(
          host.current.querySelectorAll<HTMLElement>(
            "button:not(:disabled), select, input",
          ),
        );
        const first = buttons[0],
          last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", escape);
    expandButton.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", escape);
    };
  }, [expanded]);
  const expandButton = useRef<HTMLButtonElement>(null);
  const publish = (next: Record<string, Motion>) => {
    motionRef.current = next;
    setMotions(next);
  };
  const visit = (
    id: string,
    target: Point,
    note: string,
    partnerId?: string,
    kind: "social" | "task" = "social",
    activity?: IdleActivity | "board" | "pin",
  ) => {
    const a = latest.current.agents.find((a) => a.id === id);
    if (!a) return;
    const current =
      motionRef.current[id]?.position || home(a, latest.current.layout);
    const route = officePath(
      current,
      target,
      latest.current.agents,
      latest.current.layout,
    );
    if (!route.length) return;
    publish({
      ...motionRef.current,
      [id]: {
        kind,
        position: reduced ? route.at(-1)! : current,
        route: reduced ? [] : route,
        phase: "walking",
        walkingStartedAt: Date.now(),
        note,
        partner: partnerId,
        activity,
        activityDurationMs:
          activity === "board"
            ? Infinity
            : activity === "pin"
              ? 3500
              : activityById(activity)?.duration || 3500,
      },
    });
  };
  const takeBreak = (
    id: string,
    activity: IdleActivity,
    destination?: Point,
  ) => {
    if (
      activity === "nap" &&
      Object.entries(motionRef.current).some(
        ([other, motion]) =>
          other !== id &&
          motion.activity === "nap" &&
          motion.phase !== "returning",
      )
    )
      return;
    const definition = activityById(activity);
    if (
      !definition ||
      isOfficeBusy(latest.current.run?.status) ||
      latest.current.reduced
    )
      return;
    const member = latest.current.agents.find((member) => member.id === id);
    if (!member) return;
    const target =
      destination ||
      nearestActivityTarget(
        activity,
        motionRef.current[id]?.position || home(member, latest.current.layout),
        latest.current.agents,
        latest.current.layout,
      );
    if (!target) return;
    visit(id, target, definition.label, undefined, "social", activity);
  };
  const returnToDesk = (id: string) => {
    const a = latest.current.agents.find((a) => a.id === id);
    if (!a) return;
    const position =
      motionRef.current[id]?.position || home(a, latest.current.layout);
    publish({
      ...motionRef.current,
      [id]: {
        kind: motionRef.current[id]?.kind || "social",
        position,
        route: officePath(
          position,
          home(a, latest.current.layout),
          latest.current.agents,
          latest.current.layout,
        ),
        phase: "returning",
        walkingStartedAt: Date.now(),
        activityDurationMs: 0,
        note: "Returning to desk",
      },
    });
  };
  const latestCompletion = completedRuns[0];
  const lastPinned = useRef(latestCompletion?.id);
  useEffect(() => {
    if (!latestCompletion || lastPinned.current === latestCompletion.id) return;
    lastPinned.current = latestCompletion.id;
    const finisher = latestCompletion.options?.mode === "normal"
      ? agents.find(a => a.id === "codex-normal")
      : agents.find(a => a.role === "lead");
    if (finisher) visit(finisher.id, roomItemPoint("board", roomLayout, agents, { x: 352, y: 112 }), "Pinning the final result", undefined, "task", "pin");
  }, [latestCompletion?.id]);
  useEffect(() => {
    let nextRoam = Date.now() + 45000,
      count = 0;
    let previousTick = Date.now();
    const timer = window.setInterval(() => {
      const current = latest.current,
        now = Date.now();
      const elapsed = Math.min(80,now-previousTick);
      previousTick=now;
      const next: Record<string, Motion> = {};
      for (const a of current.agents) {
        const m = motionRef.current[a.id];
        if (!m) continue;
        if (m.kind === "social" && isOfficeBusy(current.run?.status)) {
          continue;
        }
        if (current.reduced) continue;
        if (
          m.kind === "social" &&
          current.run &&
          ["queued", "running", "approval"].includes(current.run.status)
        )
          continue;
        const moved = advancePath(m.position, m.route, elapsed * 0.08);
        const arrived = m.route.length > 0 && !moved.route.length;
        const clock = updateJourneyClock(m, arrived, now);
        if (!moved.route.length && m.phase === "returning") continue;
        if (
          (clock.phase === "activity" &&
            activityRemainingMs(clock, now) === 0) ||
          (m.activity === "board" &&
            current.states[a.id] !== "planning" &&
            m.phase !== "returning")
        ) {
          next[a.id] = {
            ...m,
            ...moved,
            route: officePath(
              moved.position,
              home(a, current.layout),
              current.agents,
              current.layout,
            ),
            phase: "returning",
            walkingStartedAt: now,
            note: "Returning to desk",
            partner: undefined,
          };
        } else
          next[a.id] = {
            ...clock,
            ...moved,
          };
      }
      publish(next);
      const planner =
        !current.run?.demo &&
        !arranging &&
        current.agents.find(
          (a) => a.role === "lead" && current.states[a.id] === "planning",
        );
      if (planner && !next[planner.id]) {
        visit(
          planner.id,
          roomItemPoint("board", current.layout, current.agents, {
            x: 352,
            y: 112,
          }),
          `Planning · ${current.run?.task.split("\n")[0].slice(0, 50)}`,
          undefined,
          "task",
          "board",
        );
      }
      if (
        handoffQueue.current.length &&
        !Object.values(next).some((m) => m.kind === "task")
      ) {
        const handoff = handoffQueue.current.shift()!;
        const source = current.agents.find((a) => a.id === handoff.from),
          target = current.agents.find((a) => a.id === handoff.to);
        if (source && target && !current.reduced)
          visit(
            source.id,
            {
              x:
                home(target, current.layout).x +
                (home(target, current.layout).x > 352 ? -64 : 64),
              y: home(target, current.layout).y,
            },
            `${source.name} → ${target.name}\n${handoff.reason || `${handoff.stage} result shared`}`,
            target.id,
            "task",
          );
      }
      const eligible = current.agents.filter(
        (a) =>
          !["working", "planning", "approval"].includes(current.states[a.id]) &&
          !next[a.id],
      );
      if (
        !arranging &&
        (!current.run ||
          !["queued", "running", "approval"].includes(current.run.status)) &&
        !current.reduced &&
        now >= nextRoam &&
        eligible.length >= 1 &&
        !Object.keys(next).length
      ) {
        const a = eligible[count % eligible.length];
        // One occasional visit between the varied personal breaks.
        const b = eligible[(count + 1) % eligible.length];
        if (
          count % (idleActivities.length + 1) === idleActivities.length &&
          b.id !== a.id
        )
          visit(
            a.id,
            {
              x:
                home(b, current.layout).x +
                (home(b, current.layout).x > 352 ? -64 : 64),
              y: home(b, current.layout).y,
            },
            `Visiting ${b.name}`,
            b.id,
          );
        else takeBreak(a.id, idleActivities[count % idleActivities.length].id);
        count++;
        nextRoam = now + idleDelay();
      }
    }, 32);
    return () => window.clearInterval(timer);
  }, [reduced, arranging]);
  useEffect(() => {
    for (const e of events) {
      if (e.seq > seenEvent.current && e.handoff && !reduced)
        handoffQueue.current.push(e.handoff);
      seenEvent.current = Math.max(seenEvent.current, e.seq);
    }
  }, [events, reduced]);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    const app = new Application();
    let initialized = false;
    void (async () => {
      try {
        await app.init({
          width: ROOM_WIDTH,
          height: ROOM_HEIGHT,
          backgroundAlpha: 0,
          antialias: false,
          roundPixels: true,
          resolution: 1,
          autoDensity: false,
        });
        initialized = true;
        if (disposed) {
          app.destroy(true);
          return;
        }
        canvas.current?.appendChild(app.canvas);
        app.canvas.setAttribute("aria-hidden", "true");
        const textures = await Promise.all(
          agents.map((agent) => Assets.load(spriteAsset(agent))),
        );
        const tiles = await Assets.load("/sprites/tiles.png");
        const walkSheets = await Promise.all(agents.map(agent => Assets.load(walkSpriteAsset(agent))));
        const lifeSheets = await Promise.all(
          agents.map((agent) => Assets.load(spriteAsset(agent, true))),
        );
        if (disposed) return;
        textures.forEach((t) => (t.source.scaleMode = "nearest"));
        lifeSheets.forEach((t) => (t.source.scaleMode = "nearest"));
        tiles.source.scaleMode = "nearest";
        const room = new Container();
        app.stage.addChild(room);
        const g = new Graphics();
        g.zIndex = -3;
        room.addChild(g);
        const r = (x: number, y: number, w: number, h: number, c: string) =>
          g.rect(x, y, w, h).fill(c);
        const line = (
          x: number,
          y: number,
          w: number,
          h: number,
          c = "#352e2a",
        ) => r(x, y, w, h, c);
        // Room shell, deep wall trim, and original repeating 16px timber tiles.
        r(17, 24, 802, 474, "#0e1714");
        const palette = officeDesign(design);
        r(24, 18, 784, 464, palette.trim);
        r(30, 25, 772, 60, palette.wall);
        r(30, 83, 772, 398, palette.floor);
        const floor = new TilingSprite({
          texture: new Texture({
            source: tiles.source,
            frame: new Rectangle(0, 0, 16, 16),
          }),
          width: 768,
          height: 392,
        });
        floor.position.set(32, 86);
        floor.zIndex = -2;
        floor.tileScale.set(2);
        if (palette.pattern === "wood") room.addChild(floor);
        else {
          for (let y = 86; y < 478; y += 28)
            for (let x = 32; x < 800; x += 32) {
              const alternate =
                (Math.floor((x - 32) / 32) + Math.floor((y - 86) / 28)) % 2;
              r(
                x,
                y,
                Math.min(32, 800 - x),
                Math.min(28, 478 - y),
                palette.grout,
              );
              r(
                x + 1,
                y + 1,
                Math.min(30, 799 - x),
                Math.min(26, 477 - y),
                alternate ? palette.floor : palette.tile,
              );
              if (palette.pattern === "plank")
                r(x + 3, y + 22, Math.min(22, 797 - x), 1, palette.grout);
            }
          if (palette.id === "garden") {
            for (let x = 36; x < 800; x += 64) {
              r(x, 29, 58, 49, "#b5d1c1");
              r(x + 3, 32, 52, 43, "#90b8ac");
              r(x + 8, 34, 4, 30, "#d7e2c9");
            }
          }
          if (palette.id === "midnight") {
            r(36, 29, 760, 48, "#142138");
            for (let x = 48; x < 790; x += 41)
              r(x, 34 + (x % 29), 2, 2, "#cfdbcc");
          }
        }
        drawOfficeArchitecture(room, latest.current.layout, design);
        let decor = new Graphics();
        room.addChild(decor);
        const objects = new Map<string, Graphics>();
        const useItem = (id: string) => {
          decor = new Graphics();
          objects.set(id, decor);
          room.addChild(decor);
        };
        const dg = g; // g draws wall furniture; decor draws floor furniture above tiles.
        const rect = (x: number, y: number, w: number, h: number, c: string) =>
          decor.rect(x, y, w, h).fill(c);
        // Wall sconces, movable windows and bathroom door, shelves, and board.
        for (const item of officeFixtures.filter((item) => item.id.startsWith("window-"))) {
          const bounds = furnitureBounds(item, latest.current.layout);
          const sx = bounds.width / item.width, sy = bounds.height / item.height;
          const x = bounds.left, y = bounds.top;
          r(x, y, bounds.width, 44 * sy, "#25322f");
          r(x + 4 * sx, y + 4 * sy, 56 * sx, 33 * sy, "#76959a");
          r(x + 7 * sx, y + 7 * sy, 23 * sx, 27 * sy, "#a0c0b7");
          r(x + 34 * sx, y + 7 * sy, 19 * sx, 27 * sy, "#698e92");
          r(x + 29 * sx, y + 4 * sy, 4 * sx, 33 * sy, "#344b46");
          r(x, y + 40 * sy, bounds.width, 7 * sy, "#b49968");
        }
        for (const x of [180, 466]) {
          r(x, 41, 8, 22, "#806647");
          r(x - 3, 38, 14, 9, "#e6bd6e");
          r(x + 2, 38, 4, 6, "#fff0ad");
        }
        const bathroomDoorItem = officeFixtures[0];
        const bathroomDoorBounds = furnitureBounds(bathroomDoorItem, latest.current.layout);
        const doorScaleX = bathroomDoorBounds.width / bathroomDoorItem.width;
        const doorScaleY = bathroomDoorBounds.height / bathroomDoorItem.height;
        const doorX = bathroomDoorBounds.left, doorY = bathroomDoorBounds.top;
        r(doorX, doorY, bathroomDoorBounds.width, bathroomDoorBounds.height, "#2a302a");
        r(doorX + 4 * doorScaleX, doorY + 4 * doorScaleY, 30 * doorScaleX, 49 * doorScaleY, "#806348");
        r(doorX + 9 * doorScaleX, doorY + 10 * doorScaleY, 20 * doorScaleX, 17 * doorScaleY, "#b8c2ad");
        r(doorX + 17 * doorScaleX, doorY + 12 * doorScaleY, 4 * doorScaleX, 4 * doorScaleY, "#455447");
        r(doorX + 15 * doorScaleX, doorY + 17 * doorScaleY, 8 * doorScaleX, 7 * doorScaleY, "#455447");
        r(doorX + 26 * doorScaleX, doorY + 36 * doorScaleY, 4 * doorScaleX, 4 * doorScaleY, "#e0bd75");
        useItem("board");
        rect(278, 32, 148, 53, "#362f26");
        rect(282, 36, 140, 45, "#b59c6a");
        rect(287, 41, 130, 35, "#445347");
        rect(298, 48, 29, 18, "#e3d0a1");
        rect(338, 47, 26, 22, "#ccaf78");
        rect(376, 49, 28, 16, "#a9bc99");
        rect(306, 44, 4, 4, "#c77550");
        rect(347, 44, 4, 4, "#c77550");
        // Rug anchors the shared room.
        useItem("rug");
        rect(238, 101, 228, 290, "#634a3d");
        rect(242, 105, 220, 282, "#916850");
        rect(247, 110, 210, 272, "#7a5746");
        for (let y = 114; y < 380; y += 16) {
          rect(248, y, 3, 6, "#b28b64");
          rect(453, y, 3, 6, "#b28b64");
        }
        const plant = (x: number, y: number) => {
          rect(x + 5, y + 22, 20, 7, "#3f362c");
          rect(x + 7, y + 9, 16, 17, "#af7754");
          rect(x + 9, y + 11, 12, 4, "#d1a178");
          rect(x + 13, y - 13, 4, 24, "#4c6a47");
          rect(x + 3, y - 7, 12, 8, "#79945d");
          rect(x + 16, y - 13, 11, 8, "#839e62");
          rect(x + 18, y, 10, 6, "#55794f");
          rect(x, y - 15, 9, 9, "#a1b475");
        };
        useItem("plant-0");
        plant(42, 103);
        useItem("plant-1");
        plant(632, 103);
        useItem("plant-2");
        plant(43, 365);
        useItem("plant-3");
        plant(631, 365);
        // Research library.
        useItem("bookshelf");
        rect(54, 139, 115, 43, "#3f342c");
        rect(59, 143, 105, 31, "#78573a");
        for (let row = 0; row < 2; row++) {
          let x = 63;
          for (let i = 0; i < 13; i++) {
            rect(
              x,
              146 + row * 16,
              5,
              11,
              ["#b7805b", "#c3b485", "#738a70", "#889d9b"][i % 4],
            );
            x += 7;
          }
          rect(57, 158 + row * 17, 109, 4, "#b18a58");
        }
        // Builder's tool rack and parts.
        useItem("tool-rack");
        rect(536, 140, 112, 41, "#3d3930");
        rect(540, 144, 104, 32, "#7a7152");
        for (let i = 0; i < 7; i++) {
          rect(546 + i * 13, 147, 2, 24, "#504b3b");
          rect(544 + i * 13, 151 + (i % 2) * 5, 7, 4, "#c4b98d");
        }
        // Bed and coffee stand occupy the existing blocked furniture footprints.
        useItem("bed");
        rect(47, 274, 124, 52, "#46372e");
        rect(51, 278, 116, 42, "#c6ac83");
        rect(55, 281, 108, 34, "#e6d8b5");
        rect(59, 285, 38, 24, "#faf0d5");
        rect(63, 288, 30, 17, "#e0d6bd");
        rect(109, 280, 54, 36, "#607f91");
        rect(112, 282, 48, 4, "#91afba");
        rect(112, 309, 48, 4, "#446174");
        rect(47, 272, 7, 54, "#a37b52");
        rect(164, 279, 7, 47, "#a37b52");
        useItem("coffee");
        rect(538, 283, 90, 8, "#c4a170");
        rect(542, 291, 82, 32, "#72543c");
        rect(548, 297, 32, 21, "#98724e");
        rect(585, 297, 32, 21, "#98724e");
        rect(575, 304, 3, 3, "#dfc18b");
        rect(588, 304, 3, 3, "#dfc18b");
        rect(604, 259, 21, 25, "#344342");
        rect(607, 262, 15, 10, "#779d98");
        rect(609, 274, 3, 4, "#d0d9c4");
        rect(610, 279, 9, 5, "#f1e1b8");
        rect(609, 281, 12, 3, "#252f30");
        rect(551, 272, 14, 11, "#ac7450");
        rect(553, 269, 10, 4, "#e4c99a");
        rect(578, 276, 12, 7, "#f0e2bf");
        // Individual desks are laid out separately from character art and agent configuration.
        for (const agent of agents) {
          useItem(`desk-${agent.workstation}`);
          const [x, y] = station(agent.workstation);
          rect(x - 38, y + 35, 76, 8, "#342e26");
          rect(x - 34, y + 40, 6, 17, "#513c2a");
          rect(x + 28, y + 40, 6, 17, "#513c2a");
          rect(x - 43, y + 14, 86, 24, "#a77e4d");
          rect(x - 40, y + 16, 80, 16, "#c29a65");
          rect(x - 43, y + 34, 86, 4, "#755236");
          if (agent.role === "builder") {
            rect(x - 21, y + 1, 42, 23, "#2b3835");
            rect(x - 17, y + 4, 34, 15, "#7dafa0");
            rect(x - 14, y + 7, 15, 2, "#b6d4a0");
            rect(x - 14, y + 12, 26, 2, "#537a71");
            rect(x - 3, y + 23, 6, 4, "#4c5142");
            rect(x - 19, y + 28, 38, 4, "#655f47");
          } else if (agent.role === "reviewer") {
            rect(x - 23, y + 16, 30, 14, "#e1cda0");
            rect(x - 7, y + 16, 2, 14, "#b9a77a");
            rect(x + 16, y + 17, 8, 11, "#829e76");
            rect(x + 18, y + 13, 4, 6, "#99ac79");
            rect(x + 28, y + 23, 5, 6, "#ad95b8");
          } else {
            rect(x - 26, y + 16, 42, 14, "#dfc58e");
            rect(x - 20, y + 19, 10, 2, "#a58b60");
            rect(x - 20, y + 24, 27, 2, "#a58b60");
            rect(x + 23, y + 17, 9, 11, "#eee1b9");
            rect(x + 25, y + 17, 5, 3, "#735138");
          }
        }
        // Low wall and floor edge.
        decor = new Graphics();
        decor.zIndex = 10000;
        room.addChild(decor);
        rect(24, 474, 784, 10, "#3d3024");
        rect(24, 482, 784, 5, "#b78d55");
        rect(24, 83, 7, 399, "#b38b59");
        rect(802, 83, 6, 399, "#b38b59");
        const highlights = new Graphics();
        room.addChild(highlights);
        const sprites = new Map<string, Sprite>();
        const animationTextures = new Map<string, Texture[]>();
        const idleTextures = new Map<string, Texture[]>();
        const walkingTextures = new Map<string,Texture[]>();
        const facing = new Map<string,WalkDirection>();
        for (const agent of agents) {
          const texture = textures[agents.indexOf(agent)];
          const walkSheet = walkSheets[agents.indexOf(agent)];
          walkSheet.source.scaleMode = "nearest";
          walkingTextures.set(agent.id,Array.from({length:walkDirections.length*walkFrames},(_,index)=>new Texture({source:walkSheet.source,frame:new Rectangle((index%walkFrames)*32,Math.floor(index/walkFrames)*32,32,32)})));
          const animation = Array.from(
            { length: 8 },
            (_, i) =>
              new Texture({
                source: texture.source,
                frame: new Rectangle(i * 32, 0, 32, 32),
              }),
          );
          animationTextures.set(agent.id, animation);
          const idleSheet = lifeSheets[agents.indexOf(agent)];
          idleTextures.set(
            agent.id,
            Array.from(
              { length: 6 },
              (_, frame) =>
                new Texture({
                  source: idleSheet.source,
                  frame: new Rectangle(frame * 32, 0, 32, 32),
                }),
            ),
          );
          const s = new Sprite({ texture: animation[0] });
          s.scale.set(2);
          s.anchor.set(0.5);
          const [x, y] = station(agent.workstation);
          s.position.set(x - 32, y - 45);
          room.addChild(s);
          sprites.set(agent.id, s);
        }
        const propLayers = new Map<string, Graphics>();
        const transformItem = (
          graphic: Graphics,
          item: ReturnType<typeof furniture>[number],
          layout: RoomLayout,
        ) => {
          const origin = transformFurniturePoint(item, layout, {
            x: item.x,
            y: item.y,
          });
          graphic.pivot.set(item.x, item.y);
          graphic.position.set(origin.x, origin.y);
          graphic.angle = layout[item.id]?.rotation || 0;
          const saved = layout[item.id],
            scale = saved?.scale ?? 1;
          graphic.scale.set(
            (scale * (saved?.width ?? item.width)) / item.width,
            (scale * (saved?.height ?? item.height)) / item.height,
          );
        };
        for (const agent of agents) {
          const props = new Graphics();
          room.addChild(props);
          propLayers.set(agent.id, props);
        }
        const facingViews = new Map<string, Graphics>();
        for (const item of furniture(agents).filter(
          (item) => item.id !== "rug",
        )) {
          const agent = agents.find(
            (agent) => item.id === `desk-${agent.workstation}`,
          );
          for (const facing of [90, 180, 270] as RoomRotation[]) {
            const view = new Graphics();
            for (const pixel of furnitureView(item, facing, agent?.role))
              view
                .rect(pixel.x, pixel.y, pixel.width, pixel.height)
                .fill(pixel.color);
            view.visible = false;
            room.addChild(view);
            facingViews.set(`${item.id}:${facing}`, view);
          }
        }
        app.ticker.add(() => {
          const current = latest.current;
          highlights.clear();
          for (const item of furniture(current.agents)) {
            const graphic = objects.get(item.id);
            if (!graphic) continue;
            transformItem(graphic, item, current.layout);
            const bounds = furnitureBounds(item, current.layout);
            graphic.zIndex =
              item.id === "rug"
                ? 0
                : bounds.top +
                  (current.layout[item.id]?.rotation
                    ? bounds.height
                    : (item.depth - item.y) *
                      (current.layout[item.id]?.scale ?? 1));
            const saved = current.layout[item.id],
              facing = saved?.rotation || 0;
            graphic.visible = item.id === "rug" || facing === 0;
            for (const angle of [90, 180, 270] as RoomRotation[]) {
              const view = facingViews.get(`${item.id}:${angle}`);
              if (!view) continue;
              view.visible = facing === angle;
              if (!view.visible) continue;
              const side = angle === 90 || angle === 270,
                scale = saved?.scale ?? 1;
              const sx = (saved?.width ?? item.width) / item.width,
                sy = (saved?.height ?? item.height) / item.height;
              view.position.set(bounds.left, bounds.top);
              view.scale.set(
                scale * (side ? sy : sx),
                scale * (side ? sx : sy),
              );
              view.zIndex = graphic.zIndex;
            }
          }
          for (const agent of current.agents) {
            const s = sprites.get(agent.id);
            if (!s) continue;
            const activityProps = propLayers.get(agent.id)!;
            activityProps.clear();
            activityProps.pivot.set(0, 0);
            activityProps.position.set(0, 0);
            activityProps.angle = 0;
            activityProps.scale.set(1);
            const bedItem = furniture(current.agents).find(
              (item) => item.id === "bed",
            )!;
            const bedPosition = roomItemPoint(
              "bed",
              current.layout,
              current.agents,
              { x: 110, y: 296 },
            );
            const bedLabel = roomItemPoint(
              "bed",
              current.layout,
              current.agents,
              { x: 110, y: 306 },
            );
            const position =
              current.motions[agent.id]?.position ||
              home(agent, current.layout);
            const x = Math.round(position.x / 2) * 2,
              y = Math.round(position.y / 2) * 2;
            s.position.set(x, y - 13);
            const state = current.states[agent.id] || "idle";
            const motion = current.motions[agent.id];
            const activity =
              motion?.phase === "activity"
                ? motion.activity === "board" || motion.activity === "pin"
                  ? { id: motion.activity, frames: [2, 3] }
                  : activityById(motion?.activity)
                : undefined;
            s.alpha = activity?.id === "restroom" ? 0 : 1;
            s.angle =
              activity?.id === "nap"
                ? (current.layout.bed?.rotation || 0) - 90
                : 0;
            if (activity?.id === "nap")
              s.position.set(bedPosition.x, bedPosition.y);
            if (agent.id === current.selected)
              highlights
                .roundRect(
                  (activity?.id === "nap" ? bedLabel.x : x) - 48,
                  (activity?.id === "nap" ? bedLabel.y : y) - 48,
                  96,
                  109,
                  4,
                )
                .stroke({ color: agent.color, width: 2, alpha: 0.8 });
            const f = motion?.route.length
              ? [0, 1]
              : activity?.frames ||
                frames[
                  state === "completed" && !current.completedAt[agent.id]
                    ? "idle"
                    : state
                ];
            const frame = current.reduced
              ? f[0]
              : f[
                  Math.floor(
                    performance.now() /
                      (activity?.id === "stretch" ? 400 : 650),
                  ) % f.length
                ];
            const walking = !!motion?.route.length;
            if (walking) facing.set(agent.id,walkDirection(position,motion!.route[0],facing.get(agent.id)));
            s.texture = walking
              ? walkingTextures.get(agent.id)![walkDirections.indexOf(facing.get(agent.id) || "down")*walkFrames + (current.reduced ? 0 : Math.floor(performance.now()/100)%walkFrames)]
              :
              activity?.id === "nap"
                ? idleTextures.get(agent.id)![0]
                : activity?.id === "stretch"
                  ? idleTextures.get(agent.id)![frame]
                  : animationTextures.get(agent.id)![frame];
            const bedBounds = furnitureBounds(bedItem, current.layout);
            s.zIndex =
              activity?.id === "nap" ? bedBounds.top + bedBounds.height + 1 : y;
            activityProps.zIndex = s.zIndex + 0.1;
            const prop = (
              dx: number,
              dy: number,
              w: number,
              h: number,
              color: string,
            ) => activityProps.rect(x + dx, y + dy, w, h).fill(color);
            if (activity?.id === "plants") {
              prop(-29, -7, 12, 10, "#72a6ae");
              prop(-23, -11, 6, 5, "#a0cbd0");
              prop(-36, -5, 8, 3, "#72a6ae");
              const drop = (Math.floor(performance.now() / 250) % 3) * 4;
              prop(-39, drop, 2, 4, "#a1d8e2");
              prop(-35, 5 + drop, 2, 3, "#a1d8e2");
            }
            const actualWork =
              !current.run?.demo && state === "working" && !motion;
            if (
              activity?.id === "read" ||
              (actualWork && agent.role === "researcher")
            ) {
              prop(-12, -5, 24, 14, "#b7795e");
              prop(-10, -3, 9, 10, "#e6d5a3");
              prop(1, -3, 9, 10, "#e6d5a3");
            }
            if (activity?.id === "board") {
              const stroke = Math.floor(performance.now() / 300) % 3;
              prop(16, -36 + stroke * 2, 8, 2, "#f0dfb7");
              const board = itemOffset("board", current.layout, current.agents);
              activityProps
                .rect(
                  307 + board.x,
                  50 + board.y + stroke * 5,
                  21 + stroke * 4,
                  2,
                )
                .fill("#eee1b6");
            }
            if (activity?.id === "pin") {
              prop(12, -28, 14, 18, "#ead8a1");
              prop(16, -30, 5, 5, "#d49a54");
            }
            if (actualWork && agent.role === "builder") {
              prop(15, -6, 3, 15, "#b8b9a6");
              prop(13, -10, 7, 7, "#e2b35f");
              if (Math.floor(performance.now() / 350) % 2) {
                prop(26, -8, 3, 3, "#f6d98c");
                prop(21, -15, 2, 3, "#f6d98c");
              }
            }
            if (actualWork && agent.role === "reviewer") {
              prop(12, -9, 14, 3, "#d2bf8d");
              prop(12, -6, 3, 9, "#d2bf8d");
              prop(23, -6, 3, 9, "#d2bf8d");
              prop(12, 3, 14, 3, "#d2bf8d");
              prop(24, 7, 4, 8, "#8f7760");
            }
            if (activity?.id === "coffee") {
              prop(14, -7, 10, 10, "#ead9b0");
              prop(24, -5, 4, 6, "#ead9b0");
              prop(17, -13, 2, 4, "#c3c3b2");
            }
            if (activity?.id === "nap") {
              transformItem(activityProps, bedItem, current.layout);
              activityProps.rect(110, 280, 53, 36).fill("#607f91");
              activityProps.rect(112, 282, 48, 4).fill("#91afba");
              activityProps.rect(112, 309, 48, 4).fill("#446174");
            }
          }
          room.sortableChildren = true;
        });
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    })();
    return () => {
      disposed = true;
      if (initialized) app.destroy(true, { children: true });
    };
  }, [
    design,
    JSON.stringify(
      Object.entries(roomLayout).filter(([id]) =>
        id.startsWith("divider-") || id === "bathroom-door" || id.startsWith("window-"),
      ),
    ),
    agents
      .map((a) => `${a.id}:${a.sprite}:${a.look}:${a.workstation}:${a.role}`)
      .join("|"),
  ]);
  return (
    <div
      className={`office-wrap office-controls ${expanded ? "office-expanded" : ""}`}
      ref={host}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded || undefined}
      aria-label={expanded ? "Expanded office" : "Pixel office"}
    >
      {arranging && (
        <div className="arrange-tools">
          <span>{selectedItem?.name || "Select an item"}</span>
          <button
            className="secondary"
            disabled={!selectedItem}
            onClick={() => selectedFurniture && rotateItem(selectedFurniture)}
            title="Rotate selected item clockwise (R)"
          >
            <RotateCw size={16} /> Rotate 90°
          </button>
          <button
            className="secondary"
            aria-label="Decrease item size"
            disabled={
              !selectedItem || (roomLayout[selectedItem.id]?.scale ?? 1) <= 0.5
            }
            onClick={() => resizeItem(-1)}
          >
            <Minus size={14} /> Size
          </button>
          <span aria-label="Item size">
            {Math.round(
              (selectedItem ? (roomLayout[selectedItem.id]?.scale ?? 1) : 1) *
                100,
            )}
            %
          </span>
          <button
            className="secondary"
            aria-label="Increase item size"
            disabled={
              !selectedItem || (roomLayout[selectedItem.id]?.scale ?? 1) >= 2
            }
            onClick={() => resizeItem(1)}
          >
            <Plus size={14} /> Size
          </button>
          {selectedItem && (
            <span>{roomLayout[selectedItem.id]?.rotation || 0}°</span>
          )}
        </div>
      )}
      <OfficeViewport zoom={zoom} onZoomChange={value => {autoFit.current=false;setZoom(value);}}
        width={ROOM_WIDTH} height={ROOM_HEIGHT} resetKey={cameraReset} editing={arranging}>
        <div
          className="office-scene"
          style={{ width: ROOM_WIDTH, height: ROOM_HEIGHT }}
        >
          <div
            className="scene-inner"
            style={{
              width: ROOM_WIDTH,
              height: ROOM_HEIGHT,
            }}
          >
            <div ref={canvas} className="pixi-canvas" />
            {error && (
              <div className="canvas-error">
                The pixel renderer could not start. Your team controls remain
                available below.<small>{error}</small>
              </div>
            )}
            <button
              className="task-board-hit"
              style={{
                ...furnitureBounds(
                  furniture(agents).find((item) => item.id === "board")!,
                  roomLayout,
                ),
              }}
              onClick={onBoard}
              aria-label="Open central task board"
              title="Open task board"
            >
              {unreadBoard && <i className="task-board-unread" aria-label="New completed tasks" title="New completed tasks" />}
            </button>
            {completedRuns.slice(0, 3).map((task, index) => {
              const board = furnitureBounds(
                furniture(agents).find((item) => item.id === "board")!,
                roomLayout,
              );
              return (
                <button
                  key={task.id}
                  className="task-pin-hit"
                  aria-label={`Completed task: ${task.task}`}
                  title={task.task}
                  disabled={arranging}
                  style={{
                    left: board.left + board.width * (0.13 + index * 0.27),
                    top: board.top + board.height * 0.25,
                    width: board.width * 0.19,
                    height: board.height * 0.42,
                  }}
                  onClick={() => onOpenTask?.(task)}
                >
                  <span>{index + 1}</span>
                </button>
              );
            })}
            <button
              className="furniture-hit rug-hit"
              aria-label="Stretch on rug"
              title="Stretch on the rug"
              style={furnitureBounds(
                furniture(agents).find((item) => item.id === "rug")!,
                roomLayout,
              )}
              disabled={
                !selected || reduced || arranging || isOfficeBusy(run?.status)
              }
              onClick={() => selected && takeBreak(selected, "stretch")}
            />
            <button
              className="furniture-hit bed-hit"
              style={{
                ...furnitureBounds(
                  furniture(agents).find((item) => item.id === "bed")!,
                  roomLayout,
                ),
              }}
              aria-label="Take a nap in the bed"
              title={bedOccupied ? "Bed occupied" : "Bed · Take a nap"}
              disabled={
                !selected ||
                reduced ||
                bedOccupied ||
                arranging ||
                isOfficeBusy(run?.status)
              }
              onClick={() => selected && takeBreak(selected, "nap")}
            />
            <button
              className="furniture-hit coffee-hit"
              style={{
                ...furnitureBounds(
                  furniture(agents).find((item) => item.id === "coffee")!,
                  roomLayout,
                ),
              }}
              aria-label="Take a coffee break"
              title="Coffee stand"
              disabled={
                !selected || reduced || arranging || isOfficeBusy(run?.status)
              }
              onClick={() => selected && takeBreak(selected, "coffee")}
            />
            {officeInteractions(agents, roomLayout).map((interaction) => (
              <button
                key={interaction.id}
                className="furniture-hit activity-hit"
                style={interaction.bounds}
                aria-label={interaction.label}
                title={
                  selected
                    ? `${agents.find((agent) => agent.id === selected)?.name}: ${interaction.label}`
                    : "Select a character first"
                }
                disabled={
                  !selected || reduced || arranging || isOfficeBusy(run?.status)
                }
                onClick={() =>
                  selected &&
                  takeBreak(selected, interaction.activity, interaction.target)
                }
              />
            ))}
            {agents.map((a) => {
              const motion = motions[a.id];
              const sleeping =
                motion?.activity === "nap" && motion.phase === "activity";
              const position = sleeping
                ? roomItemPoint("bed", roomLayout, agents, { x: 110, y: 306 })
                : motion?.position || home(a, roomLayout);
              const x = Math.round(position.x / 2) * 2,
                y = Math.round(position.y / 2) * 2;
              const state = states[a.id] || "idle";
              const progress = events
                .filter(
                  (event) =>
                    event.agentId === a.id &&
                    ["message", "tool"].includes(event.kind),
                )
                .at(-1);
              const progressText = progressByAgent[a.id] || progress?.text || label[state];
              const meeting = motions[a.id];
              const breakActivity =
                meeting?.phase === "activity"
                  ? activityById(meeting?.activity)
                  : undefined;
              const motionText = meeting
                ? `${meeting.kind === "task" ? "Task" : "Social"}: ${meeting.note}`
                : "";
              const visitor = agents.find(
                (other) =>
                  motions[other.id]?.partner === a.id &&
                  motions[other.id]?.phase === "activity",
              );
              return (
                <div
                  className="agent-location"
                  key={a.id}
                  style={{ left: x, top: y }}
                >
                  <button
                    className={`character-hit ${selected === a.id ? "selected" : ""}`}
                    onClick={() => onSelect(a.id)}
                    aria-label={`${a.name}, ${a.title}: ${label[state]}${motionText ? ` · ${motionText}` : ""}`}
                    title={`${a.title} · ${a.expertise.join(", ")}\n${label[state]}${meeting ? `\n${meeting.note} (office animation)` : ""}`}
                    style={{ "--agent": a.color } as React.CSSProperties}
                  >
                    <span className="character-name">{a.name}</span>
                    {!["idle", "completed"].includes(state) && !motion && (
                      <span className="character-state">
                        <i className={`status-dot ${state}`} />
                        {state === "idle"
                          ? "Ready"
                          : state === "approval"
                            ? "Needs you"
                            : state === "completed"
                              ? "Delivered"
                              : state}
                      </span>
                    )}
                  </button>
                  {["working", "planning"].includes(state) &&
                    selected === a.id &&
                    !meeting &&
                    !visitor &&
                    !arranging && (
                      <button
                        className="work-note"
                        title={progressText}
                        style={{
                          left:
                            Math.max(92, Math.min(ROOM_WIDTH - 92, x + 24)) - x,
                        }}
                        aria-label={`${a.name} activity`}
                        onClick={onViewChat}
                      >
                        {officeActivity(progressText)}
                      </button>
                    )}
                  {breakActivity &&
                    ["nap", "stretch", "window", "restroom"].includes(
                      breakActivity.id,
                    ) && (
                      <span className="idle-marker" aria-hidden="true">
                        {breakActivity.marker}
                      </span>
                    )}
                  {selected === a.id && (meeting || visitor) && !arranging && (
                    <span
                      className={`social-bubble ${meeting?.kind === "task" || (visitor && motions[visitor.id]?.kind === "task") ? "task-handoff" : "casual-visit"}`}
                      style={{
                        left:
                          Math.max(92, Math.min(ROOM_WIDTH - 92, x + 24)) - x,
                        transform: "translateX(-50%)",
                      }}
                    >
                      <b>
                        {meeting?.kind === "task" ||
                        (visitor && motions[visitor.id]?.kind === "task")
                          ? "Task"
                          : "Social"}
                      </b>
                      {" · "}
                      {visitor && motions[visitor.id]?.kind === "task"
                        ? motions[visitor.id].note
                        : visitor
                          ? `${motions[visitor.id]?.kind === "task" ? "Receiving from" : "Visiting with"} ${visitor.name}`
                          : meeting!.note}
                      {meeting?.kind === "task" && (
                        <small
                          className="journey-clock"
                          data-phase={
                            (meeting || (visitor && motions[visitor.id]))?.phase
                          }
                        >
                          {journeyLabel(
                            (meeting ||
                              (visitor && motions[visitor.id])) as Motion,
                            Date.now(),
                          )}
                        </small>
                      )}
                    </span>
                  )}
                  {state === "approval" && (
                    <button
                      className="approval-bubble"
                      onClick={() => onApproval(a.id)}
                      aria-label={`Review ${a.name}'s approval request`}
                    >
                      <MessageCircle size={14} />?
                    </button>
                  )}
                  {state === "completed" && completedAt[a.id] && !arranging && (
                    <span className="result-bubble" title="Result delivered">
                      <Check size={12} />
                    </span>
                  )}
                  {state === "failed" && (
                    <span className="result-bubble error">
                      <AlertTriangle size={12} />
                    </span>
                  )}
                </div>
              );
            })}
            {arranging &&
              layoutFurniture.map((item) => {
                const origin = roomLayout[item.id] || item;
                const bounds = furnitureBounds(item, roomLayout);
                return (
                  <div key={item.id} style={{ display: "contents" }}>
                    <button
                      key={item.id}
                      className={`layout-handle ${selectedFurniture === item.id ? "selected" : ""}`}
                      onFocus={() => setSelectedFurniture(item.id)}
                      onClick={() => setSelectedFurniture(item.id)}
                      aria-label={`Move ${item.name}`}
                      title="Drag to move · Arrow keys to adjust · R to rotate"
                      style={{
                        ...furnitureBounds(item, roomLayout),
                        zIndex: item.id === "rug" ? 20 : 50,
                      }}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        setSelectedFurniture(item.id);
                        drag.current = {
                          id: item.id,
                          x: event.clientX,
                          y: event.clientY,
                          origin: { x: origin.x, y: origin.y },
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        const current = drag.current;
                        if (current?.id !== item.id) return;
                        const next = {
                          ...latest.current.layout,
                          [item.id]: placeFurniture(
                            item,
                            current.origin.x +
                              (event.clientX - current.x) / zoom,
                            current.origin.y +
                              (event.clientY - current.y) / zoom,
                            latest.current.layout[item.id]?.rotation,
                            latest.current.layout[item.id]?.scale,
                            {
                              width: latest.current.layout[item.id]?.width,
                              height: latest.current.layout[item.id]?.height,
                            },
                          ),
                        };
                        latest.current.layout = next;
                        setRoomLayout(next);
                      }}
                      onPointerUp={() => {
                        if (!drag.current) return;
                        drag.current = undefined;
                        void saveLayout(latest.current.layout);
                      }}
                      onPointerCancel={() => {
                        drag.current = undefined;
                        setRoomLayout(layout);
                      }}
                      onKeyDown={(event) => {
                        if (event.key.toLowerCase() === "r") {
                          event.preventDefault();
                          if (!event.repeat) rotateItem(item.id);
                          return;
                        }
                        const changes: Record<string, Point> = {
                          ArrowLeft: { x: -8, y: 0 },
                          ArrowRight: { x: 8, y: 0 },
                          ArrowUp: { x: 0, y: -8 },
                          ArrowDown: { x: 0, y: 8 },
                        };
                        const delta = changes[event.key];
                        if (!delta) return;
                        event.preventDefault();
                        const next = {
                          ...latest.current.layout,
                          [item.id]: placeFurniture(
                            item,
                            origin.x + delta.x,
                            origin.y + delta.y,
                            latest.current.layout[item.id]?.rotation,
                            latest.current.layout[item.id]?.scale,
                            {
                              width: latest.current.layout[item.id]?.width,
                              height: latest.current.layout[item.id]?.height,
                            },
                          ),
                        };
                        latest.current.layout = next;
                        setRoomLayout(next);
                      }}
                      onKeyUp={(event) => {
                        if (event.key.startsWith("Arrow"))
                          void saveLayout(latest.current.layout);
                      }}
                    >
                      {item.name}
                    </button>
                    {selectedFurniture === item.id &&
                      (
                        [
                          "n",
                          "s",
                          "e",
                          "w",
                          "ne",
                          "nw",
                          "se",
                          "sw",
                        ] as ResizeEdge[]
                      ).map((edge) => {
                        const corner = edge.length === 2;
                        const left = edge.includes("w")
                          ? bounds.left - 4
                          : edge.includes("e")
                            ? bounds.left + bounds.width - 4
                            : bounds.left + 8;
                        const top = edge.includes("n")
                          ? bounds.top - 4
                          : edge.includes("s")
                            ? bounds.top + bounds.height - 4
                            : bounds.top + 8;
                        return (
                          <button
                            key={edge}
                            className={`furniture-resize-handle edge-${edge}`}
                            aria-label={`Resize ${item.name} ${edge}`}
                            title="Drag border to resize"
                            style={{
                              left,
                              top,
                              width:
                                corner || edge === "e" || edge === "w"
                                  ? 8
                                  : Math.max(8, bounds.width - 16),
                              height:
                                corner || edge === "n" || edge === "s"
                                  ? 8
                                  : Math.max(8, bounds.height - 16),
                            }}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              furnitureResize.current = {
                                id: item.id,
                                edge,
                                x: event.clientX,
                                y: event.clientY,
                                original: roomLayout[item.id] || {
                                  x: item.x,
                                  y: item.y,
                                },
                              };
                              event.currentTarget.setPointerCapture(
                                event.pointerId,
                              );
                            }}
                            onPointerMove={(event) => {
                              const current = furnitureResize.current;
                              if (
                                current?.id !== item.id ||
                                current.edge !== edge
                              )
                                return;
                              const next = {
                                ...latest.current.layout,
                                [item.id]: resizeFurniture(
                                  item,
                                  current.original,
                                  edge,
                                  (event.clientX - current.x) / zoom,
                                  (event.clientY - current.y) / zoom,
                                ),
                              };
                              latest.current.layout = next;
                              setRoomLayout(next);
                            }}
                            onPointerUp={() => {
                              if (furnitureResize.current) {
                                furnitureResize.current = undefined;
                                void saveLayout(latest.current.layout);
                              }
                            }}
                            onPointerCancel={() => {
                              furnitureResize.current = undefined;
                              setRoomLayout(layout);
                            }}
                            onKeyDown={(event) => {
                              if (!event.key.startsWith("Arrow")) return;
                              event.preventDefault();
                              const next = {
                                ...latest.current.layout,
                                [item.id]: resizeFurniture(
                                  item,
                                  roomLayout[item.id] || {
                                    x: item.x,
                                    y: item.y,
                                  },
                                  edge,
                                  event.key === "ArrowRight"
                                    ? 4
                                    : event.key === "ArrowLeft"
                                      ? -4
                                      : 0,
                                  event.key === "ArrowDown"
                                    ? 4
                                    : event.key === "ArrowUp"
                                      ? -4
                                      : 0,
                                ),
                              };
                              latest.current.layout = next;
                              setRoomLayout(next);
                            }}
                            onKeyUp={(event) => {
                              if (event.key.startsWith("Arrow"))
                                void saveLayout(latest.current.layout);
                            }}
                          />
                        );
                      })}
                  </div>
                );
              })}
          </div>
        </div>
      </OfficeViewport>
      <div className="office-caption">
        {layoutSave && (
          <span role="status" className="layout-save-status">
            {layoutSave}
          </span>
        )}
        <div className="office-mode-tools">
        <button
          className="quiet"
          aria-pressed={arranging}
          aria-label={
            arranging ? "Finish editing office layout" : "Edit office layout"
          }
          title={
            arranging ? "Finish editing office layout" : "Edit office layout"
          }
          disabled={isOfficeBusy(run?.status)}
          onClick={() => {
            setArranging(!arranging);
            motionRef.current = {};
            setMotions({});
          }}
        >
          {arranging ? <Check size={17} /> : <Pencil size={17} />}
        </button>
        {viewControl}
        </div>
        {arranging && (
          <button
            className="quiet"
            onClick={() => {
              setRoomLayout({});
              void saveLayout({});
            }}
          >
            Reset layout
          </button>
        )}
        <div className="zoom-controls">
          <button
            aria-label="Zoom out"
            disabled={zoom <= 0.2}
            onClick={() => {
              autoFit.current = false;
              setZoom((current) => clampCameraZoom(Math.round((current - 0.1) * 100) / 100));
            }}
          >
            <Minus size={14} />
          </button>
          <span>{Math.round(zoom*100)/100}×</span>
          <button
            aria-label="Zoom in"
            disabled={zoom >= 3}
            onClick={() => {
              autoFit.current = false;
              setZoom((current) => clampCameraZoom(Math.round((current + 0.1) * 100) / 100));
            }}
          >
            <Plus size={14} />
          </button>
          <button
            aria-label="Fit office"
            title="Fit and center office"
            onClick={() => {
              autoFit.current = true;
              setCameraReset(value => value + 1);
              fitOffice();
            }}
          >
            <Focus size={14} />
            Fit
          </button>
          <button
            ref={expandButton}
            aria-label={expanded ? "Close expanded office" : "Expand office"}
            aria-expanded={expanded}
            title={expanded ? "Close (Escape)" : "Expand office"}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>
      {import.meta.env.DEV && (
        <details className="office-life">
        <summary>Social controls</summary>
        <div className="office-interactions">
          <span>
            {agents.find((a) => a.id === selected)?.name || "Select a member"}
          </span>
          <select
            aria-label="Idle activity"
            value={idleChoice}
            onChange={(event) =>
              setIdleChoice(event.target.value as IdleActivity)
            }
          >
            {idleActivities.map((activity) => (
              <option key={activity.id} value={activity.id}>
                {activity.label}
              </option>
            ))}
          </select>
          <button
            className="secondary"
            disabled={
              !selected ||
              reduced ||
              (idleChoice === "nap" && bedOccupied) ||
              isOfficeBusy(run?.status)
            }
            onClick={() => selected && takeBreak(selected, idleChoice)}
            title={
              idleChoice === "nap" && bedOccupied ? "Bed occupied" : undefined
            }
          >
            Start activity
          </button>
          <button
            className="secondary"
            disabled={
              !selected ||
              reduced ||
              (!!run && ["queued", "running", "approval"].includes(run.status))
            }
            onClick={() =>
              selected &&
              visit(selected, { x: 208, y: 336 }, "Walking to lounge")
            }
          >
            Walk to lounge
          </button>
          <select
            aria-label="Teammate to visit"
            value={partner}
            onChange={(e) => setPartner(e.target.value)}
          >
            <option value="">Visit teammate…</option>
            {agents
              .filter((a) => a.id !== selected)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
          <button
            className="secondary"
            disabled={
              !selected ||
              !agents.some((a) => a.id === partner && a.id !== selected) ||
              reduced ||
              (!!run && ["queued", "running", "approval"].includes(run.status))
            }
            onClick={() => {
              const other = agents.find((a) => a.id === partner);
              if (selected && other)
                visit(
                  selected,
                  {
                    x:
                      home(other, roomLayout).x +
                      (home(other, roomLayout).x > 352 ? -64 : 64),
                    y: home(other, roomLayout).y,
                  },
                  `Visiting ${other.name}`,
                  other.id,
                );
            }}
          >
            Meet
          </button>
          <button
            className="quiet"
            disabled={!selected || !motions[selected] || reduced}
            onClick={() => selected && returnToDesk(selected)}
          >
            Return to desk
          </button>
          <span
            className="muted"
            title="Movement and social bubbles are visual animations. They do not send agent messages or change task progress."
          >
            Decorative office life
          </span>
        </div>
        </details>
      )}
      {events.some((e) => e.handoff) && (
        <details className="handoff-receipt">
          <summary>
            Task handoffs · {events.filter((e) => e.handoff).length}
          </summary>
          {events
            .filter((e) => e.handoff)
            .slice(-8)
            .reverse()
            .map((e) => (
              <details key={e.seq}>
                <summary>{e.text}</summary>
                <pre>
                  {e.handoff?.reason}
                  {e.handoff?.objective
                    ? `\nAssignment: ${e.handoff.objective}\n\n`
                    : "\n"}
                  {e.handoff?.excerpt}
                </pre>
              </details>
            ))}
        </details>
      )}
    </div>
  );
}
