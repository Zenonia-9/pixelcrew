import { roomPlans, roomDividers } from "./office-rooms";
import type { Agent } from "./types";
import { normalAgent, normalStation } from "./normal-agent";
import { furniture, placeFurniture, type RoomLayout } from "./room-layout";
export const officeLayouts = [
  {
    id: "suite",
    name: "Connected suite",
    description:
      "Research, team room and build lab opening into a shared lounge.",
    preview: [
      [19, 31],
      [47, 31],
      [80, 31],
      [46, 79],
      [88, 83],
    ],
  },
  {
    id: "commons",
    name: "Creative commons",
    description:
      "An open studio, coffee club, and a quiet corner for creative breaks.",
    preview: [
      [18, 29],
      [43, 29],
      [18, 69],
      [43, 69],
      [82, 63],
    ],
  },
  {
    id: "focus",
    name: "Focus house",
    description: "Two quiet workrooms, a central passage and a common room.",
    preview: [
      [19, 29],
      [37, 29],
      [65, 29],
      [84, 29],
      [88, 83],
    ],
  },
  {
    id: "workshop",
    name: "Workshop",
    description: "Four work areas around a central rug.",
    preview: [
      [44, 24],
      [18, 47],
      [70, 47],
      [44, 69],
      [88, 83],
    ],
  },
  {
    id: "studio",
    name: "Open studio",
    description: "Two rows of desks with an open central aisle.",
    preview: [
      [16, 30],
      [42, 30],
      [68, 30],
      [16, 74],
      [88, 83],
    ],
  },
  {
    id: "library",
    name: "Library",
    description: "Quiet work areas along the edges.",
    preview: [
      [18, 30],
      [18, 64],
      [76, 30],
      [76, 64],
      [88, 83],
    ],
  },
] as const;
export function officeLayout(id: string, agents: Agent[], legacyCommons = false): RoomLayout {
  if (!officeLayouts.some((preset) => preset.id === id))
    throw Error("Unknown office layout.");
  if (id === "workshop") return {};
  const lead = agents.find((agent) => agent.role === "lead")!;
  const members =
    agents.length < 12
      ? [...agents, normalAgent(lead, normalStation(agents))]
      : agents;
  const items = furniture(members);
  const layout: RoomLayout = {};
  if (roomPlans[id]) {
    const slots =
      id === "suite"
        ? [
            [352, 160],
            [96, 160],
            [616, 160],
            [352, 368],
            [128, 240],
            [352, 240],
            [616, 240],
            [224, 368],
            [704, 384],
            [224, 432],
            [352, 432],
            [488, 432],
          ]
        : id === "commons"
          ? members.length <= 6
            ? legacyCommons ? [
                [112, 136],
                [392, 136],
                [392, 312],
                [624, 232],
                [344, 248],
                [456, 248],
                [568, 128],
                [680, 128],
                [624, 376],
                [344, 368],
                [456, 368],
                [568, 368],
              ]
              : [
                  [112, 160], [352, 128], [112, 344], [328, 344],
                  [240, 136], [440, 136], [112, 232], [328, 232],
                  [680, 336], [440, 344], [240, 344], [440, 232],
                ]
            : [
                [48, 160], [160, 160], [272, 160], [384, 160],
                [48, 224], [384, 224], [48, 288], [384, 288],
                [48, 352], [160, 368], [272, 368], [384, 352],
              ]
          : [
              [96, 160],
              [264, 160],
              [504, 160],
              [688, 160],
              [176, 216],
              [592, 216],
              [224, 368],
              [352, 368],
              [704, 384],
              [224, 432],
              [352, 432],
              [488, 432],
            ];
    for (const member of members) {
      const item = items.find(
        (item) => item.id === `desk-${member.workstation}`,
      )!;
      const [x, y] = slots[member.workstation];
      const rotation =
        id === "commons" && members.length <= 6
          ? ({ 2: 0, 3: 0, 8: 0 } as Record<number, 0 | 90 | 180 | 270>)[
              member.workstation
            ] || 0
          : 0;
      layout[item.id] = placeFurniture(item, x, y, rotation);
    }
    const decor: Record<string, number[]> =
      id === "commons"
        ? {
            bookshelf: [48, 88],
            "tool-rack": [600, 96],
            bed: [560, 408],
            coffee: [704, 168],
            rug: [160, 224],
            "plant-0": [224, 96],
            "plant-1": [760, 96],
            "plant-2": members.length <= 6 ? [40, 352] : [224, 416],
            "plant-3": [744, 416],
          }
        : {
            bookshelf: [40, 88],
            "tool-rack": [568, 88],
            bed: [40, 424],
            coffee: [560, 336],
            rug: [288, 336],
            "plant-0": [208, 88],
            "plant-1": [760, 88],
            "plant-2": [40, 352],
            "plant-3": [760, 424],
          };
    for (const [key, [x, y]] of Object.entries(decor)) {
      const item = items.find((item) => item.id === key)!;
      layout[key] = placeFurniture(
        item,
        x,
        y,
        0,
        1,
        key === "rug" ? id === "commons" && !legacyCommons && members.length <= 6 ? { width: 192, height: 140 } : { width: 176, height: 128 } : {},
      );
    }
    for (const item of roomDividers.filter((item) =>
      item.id.startsWith(`divider-${id}-`),
    ))
      layout[item.id] = placeFurniture(item, item.x, item.y, 0, 1, {
        width: item.width,
        height: item.height,
      });
    return layout;
  }
  const slots =
    id === "studio"
      ? [
          [88, 184],
          [280, 184],
          [472, 184],
          [88, 360],
          [280, 360],
          [472, 360],
          [664, 184],
          [664, 360],
          [664, 416],
          [88, 252],
          [280, 252],
          [472, 252],
        ]
      : [
          [88, 184],
          [88, 320],
          [600, 184],
          [600, 320],
          [256, 392],
          [448, 392],
          [256, 184],
          [448, 184],
          [664, 416],
          [256, 256],
          [448, 256],
          [664, 256],
        ];
  for (const member of members) {
    const desk = items.find(
      (item) => item.id === `desk-${member.workstation}`,
    )!;
    const [x, y] = slots[member.workstation];
    layout[desk.id] = placeFurniture(desk, x, y);
  }
  const decor =
    id === "studio"
      ? {
          bookshelf: [40, 90],
          "plant-0": [208, 88],
          "plant-1": [744, 88],
          "tool-rack": [576, 90],
          coffee: [704, 240],
          bed: [40, 416],
          rug: [248, 224],
        }
      : {
          bookshelf: [40, 90],
          "plant-0": [208, 88],
          "plant-1": [744, 88],
          "tool-rack": [576, 90],
          coffee: [704, 240],
          bed: [40, 416],
          rug: [288, 224],
        };
  for (const [key, [x, y]] of Object.entries(decor)) {
    const item = items.find((item) => item.id === key)!;
    layout[key] = placeFurniture(
      item,
      x,
      y,
      0,
      1,
      key === "rug" ? { width: 176, height: 128 } : {},
    );
  }
  return layout;
}

/** The unmodified Creative Commons layout shipped before the three-room redesign. */
export function previousCreativeCommonsLayout(agents: Agent[]): RoomLayout {
  const lead = agents.find((agent) => agent.role === "lead")!;
  const members =
    agents.length < 12
      ? [...agents, normalAgent(lead, normalStation(agents))]
      : agents;
  const items = furniture(members);
  const layout: RoomLayout = {};
  const small = members.length <= 6;
  const slots = small
    ? [
        [112, 136], [344, 128], [568, 128], [344, 280], [456, 208],
        [456, 376], [680, 128], [680, 376], [568, 280], [344, 376],
        [568, 376], [680, 280],
      ]
    : [
        [48, 136], [168, 136], [328, 128], [424, 128], [520, 128],
        [616, 128], [712, 128], [328, 216], [424, 216], [520, 216],
        [616, 216], [712, 216],
      ];
  for (const member of members) {
    const item = items.find(
      (entry) => entry.id === `desk-${member.workstation}`,
    )!;
    const [x, y] = slots[member.workstation];
    layout[item.id] = placeFurniture(item, x, y);
  }
  const decor: Record<string, number[]> = {
    bookshelf: [40, 328],
    "tool-rack": small ? [664, 88] : [328, 280],
    bed: [48, 400],
    coffee: [704, 280],
    rug: [344, 360],
    "plant-0": [248, 104],
    "plant-1": [760, 168],
    "plant-2": [256, 328],
    "plant-3": [744, 432],
  };
  for (const [id, [x, y]] of Object.entries(decor)) {
    const item = items.find((entry) => entry.id === id)!;
    layout[id] = placeFurniture(
      item,
      x,
      y,
      0,
      1,
      id === "rug" && small ? { width: 240, height: 104 } : {},
    );
  }
  const oldDividers = [
    [304, 88, 12, 128],
    [40, 208, 104, 12],
    [216, 208, 100, 12],
    [192, 312, 16, 56],
    [192, 432, 16, 40],
  ];
  oldDividers.forEach(([x, y, width, height], index) => {
    const item = {
      id: `divider-commons-${index}`,
      name: "Room partition",
      x,
      y,
      width,
      height,
      depth: y + height,
    };
    layout[item.id] = placeFurniture(item, x, y, 0, 1, { width, height });
  });
  return layout;
}
