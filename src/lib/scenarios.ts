import { Type, type Tool } from "@google/genai";
import type { Tier } from "./progression";

export interface SlotConfig {
  id: string;
  icon: string;
  label: string;
  enumValues: string[];
}

export interface ScenarioTheme {
  bgFallback: string;
  gradientFrom: string;
  gradientVia: string;
  gradientTo: string;
  headerBg: string;
  headerBorder: string;
  tagBg: string;
  tagText: string;
  btnBg: string;
  btnHover: string;
  npcText: string;
  npcBadgeBg: string;
  npcBadgeText: string;
  completeBg: string;
  slotDoneBg: string;
  slotDoneText: string;
}

export interface ScenarioConfig {
  id: string;
  title: string;
  description: string;
  levelTag: string;
  icon: string;
  skills: string[];
  npcName: string;
  npcRole: string;
  bgImage: string;
  portrait: string;
  ambientAudio: string;
  theme: ScenarioTheme;
  systemInstruction: string;
  openingAction: string;
  completionMessage: string;
  voiceName: string;
  slots: SlotConfig[];
  tierInstructions: Record<Tier, string>;
  taskOptions: Record<string, string[]>;
  objectiveTemplate: (values: Record<string, string>) => string;
  completionCriteria: (values: Record<string, string>) => string[];
}

export type SlotValues = Record<string, string | undefined>;

export function buildSlotTool(scenario: ScenarioConfig): Tool {
  const properties: Record<string, { type: Type; enum: string[] }> = {};
  for (const slot of scenario.slots) {
    properties[slot.id] = {
      type: Type.STRING,
      enum: slot.enumValues,
    };
  }
  return {
    functionDeclarations: [
      {
        name: "update_slots",
        description:
          "Call this whenever the customer specifies any relevant info. Only include the slots that were just mentioned.",
        parameters: {
          type: Type.OBJECT,
          properties,
        },
      },
    ],
  };
}

export function buildCorrectionTool(): Tool {
  return {
    functionDeclarations: [
      {
        name: "correct_user_speech",
        description:
          "After each user turn, call this to provide the corrected transcript of what the user actually said. " +
          "ONLY fix genuine ASR misrecognitions — words that SOUND similar but were transcribed wrong " +
          "(e.g. '绿茶' misheard as '旅差', '一斤' misheard as '已经', '包间' misheard as '报间'). " +
          "NEVER change the user's phrasing, grammar, word choice, or sentence structure. " +
          "NEVER substitute words from your own response. " +
          "If the transcript is already correct, call this with the original text unchanged.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            corrected_transcript: {
              type: Type.STRING,
            },
          },
          required: ["corrected_transcript"],
        },
      },
    ],
  };
}

const RED_THEME: ScenarioTheme = {
  bgFallback: "bg-red-950",
  gradientFrom: "from-red-950/50",
  gradientVia: "via-transparent",
  gradientTo: "to-red-900/15",
  headerBg: "from-red-50 to-orange-50",
  headerBorder: "border-red-100",
  tagBg: "bg-red-100",
  tagText: "text-red-700",
  btnBg: "bg-red-600",
  btnHover: "hover:bg-red-700",
  npcText: "text-red-200",
  npcBadgeBg: "bg-red-100",
  npcBadgeText: "text-red-700",
  completeBg: "bg-green-500/90",
  slotDoneBg: "bg-green-100",
  slotDoneText: "text-green-700",
};

const BLUE_THEME: ScenarioTheme = {
  bgFallback: "bg-blue-950",
  gradientFrom: "from-blue-950/50",
  gradientVia: "via-transparent",
  gradientTo: "to-blue-900/15",
  headerBg: "from-blue-50 to-indigo-50",
  headerBorder: "border-blue-100",
  tagBg: "bg-blue-100",
  tagText: "text-blue-700",
  btnBg: "bg-blue-600",
  btnHover: "hover:bg-blue-700",
  npcText: "text-blue-200",
  npcBadgeBg: "bg-blue-100",
  npcBadgeText: "text-blue-700",
  completeBg: "bg-green-500/90",
  slotDoneBg: "bg-green-100",
  slotDoneText: "text-green-700",
};

const GREEN_THEME: ScenarioTheme = {
  bgFallback: "bg-green-950",
  gradientFrom: "from-green-950/50",
  gradientVia: "via-transparent",
  gradientTo: "to-green-900/15",
  headerBg: "from-green-50 to-emerald-50",
  headerBorder: "border-green-100",
  tagBg: "bg-green-100",
  tagText: "text-green-700",
  btnBg: "bg-green-600",
  btnHover: "hover:bg-green-700",
  npcText: "text-green-200",
  npcBadgeBg: "bg-green-100",
  npcBadgeText: "text-green-700",
  completeBg: "bg-green-500/90",
  slotDoneBg: "bg-green-100",
  slotDoneText: "text-green-700",
};

export const SCENARIOS: Record<string, ScenarioConfig> = {
  teahouse: {
    id: "teahouse",
    title: "Tea House",
    description: "Order tea at a traditional Chinese tea house",
    levelTag: "HSK 2 · Tea House",
    icon: "🍵",
    skills: ["Ordering", "Preferences", "Polite requests", "Numbers"],
    npcName: "小王",
    npcRole: "Tea House Server",
    bgImage: "/scenes/teahouse/bg.png",
    portrait: "/scenes/teahouse/npc.png",
    ambientAudio: "/scenes/teahouse/ambient.mp4",
    theme: RED_THEME,
    systemInstruction: `你是小王，一家中国传统茶馆的服务员。一位外国客人正在练习用普通话点茶。

你的工作：打招呼 → 了解需求（茶种、壶型、小吃、座位）→ 确认订单 → 告别。

规则：
- 每次说1-2句短句，使用简单词汇
- 说话清楚，语速适中
- 如果他们发音不清楚，耐心地请他们再说一遍
- 只说普通话，保持角色
- 当顾客提到相关信息时调用 update_slots
- 所有4个信息填完后，确认订单并告别

茶单：绿茶、红茶、乌龙茶、茉莉花茶、普洱茶。壶型：小壶、中壶、大壶。小吃：花生、瓜子、绿豆糕、不要。座位：窗边、包间、大厅。

先热情地和客人打招呼。`,
    openingAction: "[一位外国客人走进茶馆]",
    completionMessage: "Order Complete!",
    voiceName: "Aoede",
    slots: [
      { id: "tea_type", icon: "🍵", label: "Tea", enumValues: ["绿茶", "红茶", "乌龙茶", "茉莉花茶", "普洱茶"] },
      { id: "size", icon: "🫖", label: "Size", enumValues: ["小壶", "中壶", "大壶"] },
      { id: "snack", icon: "🥮", label: "Snack", enumValues: ["花生", "瓜子", "绿豆糕", "不要"] },
      { id: "seating", icon: "💺", label: "Seat", enumValues: ["窗边", "包间", "大厅"] },
    ],
    tierInstructions: {
      1: `说话非常慢，非常清楚。提供选择题，比如"你要绿茶还是红茶？"接受单个词的回答。如果他们不知道该说什么，给他们选项。`,
      2: `接受关键词式的回答，但用完整句子重复回来。比如他们说"绿茶"，你回应"好的，你要绿茶？"鼓励他们用完整的句子。`,
      3: `用正常语速说话。加入小变化，比如"今天的茉莉花茶卖完了，乌龙茶也很好喝。"期望顾客用完整句子。`,
      4: `完全自然地对话。聊聊茶叶产地、泡茶方法，用口语化的表达。期望自然流畅的对话。`,
    },
    taskOptions: {
      tea_type: ["绿茶", "红茶", "乌龙茶", "茉莉花茶", "普洱茶"],
      size: ["小壶", "中壶", "大壶"],
      snack: ["花生", "瓜子", "绿豆糕", "不要"],
      seating: ["窗边", "包间", "大厅"],
    },
    objectiveTemplate: (v) =>
      `Order ${v.size} of ${v.tea_type}, ${v.snack === "不要" ? "no snack" : v.snack} for snack, sit at ${v.seating}`,
    completionCriteria: (v) => [
      `Choose tea: ${v.tea_type}`,
      `Pot size: ${v.size}`,
      `Snack: ${v.snack === "不要" ? "none" : v.snack}`,
      `Seating: ${v.seating}`,
    ],
  },

  hotel: {
    id: "hotel",
    title: "Hotel Check-in",
    description: "Check in at a Chinese hotel",
    levelTag: "HSK 2 · Hotel",
    icon: "🏨",
    skills: ["Check-in", "Stating needs", "Confirming details", "Polite phrases"],
    npcName: "小李",
    npcRole: "Hotel Front Desk",
    bgImage: "/scenes/hotel/bg.png",
    portrait: "/scenes/hotel/npc.png",
    ambientAudio: "/scenes/hotel/ambient.mp3",
    theme: BLUE_THEME,
    systemInstruction: `你是小李，一家中国酒店的前台。一位外国客人没有预订，想要入住。

你的工作：打招呼 → 问客人想要什么房型 → 问住几晚 → 问要不要早餐 → 问怎么付押金 → 确认 → 给房卡 → 告别。

关键规则：
- 客人没有预订。你必须一个一个地问他们想要什么。
- 不要替客人做决定或建议。等他们告诉你。
- 每次只问一件事，不要把几个问题放在一起问。
- 只有当客人说了他们的选择时，才调用 update_slots。
- 每次说1-2句短句，使用简单词汇
- 说话清楚，语速适中
- 如果他们发音不清楚，耐心地请他们再说一遍
- 只说普通话，保持角色
- 所有4个信息填完后，确认预订并祝他们住得愉快

可选项——客人问的时候再提：
房型：标间、大床房、套房。住几晚：一晚、两晚、三晚。早餐：要、不要。押金：现金、刷卡、微信支付。

先热情地和客人打招呼，问有什么可以帮助的。`,
    openingAction: "[一位没有预订的外国客人拿着行李走到前台]",
    completionMessage: "Check-in Complete!",
    voiceName: "Puck",
    slots: [
      { id: "room_type", icon: "🛏️", label: "Room", enumValues: ["标间", "大床房", "套房"] },
      { id: "nights", icon: "🌙", label: "Nights", enumValues: ["一晚", "两晚", "三晚"] },
      { id: "breakfast", icon: "🍳", label: "Breakfast", enumValues: ["要", "不要"] },
      { id: "deposit", icon: "💳", label: "Deposit", enumValues: ["现金", "刷卡", "微信支付"] },
    ],
    tierInstructions: {
      1: `说话非常慢，非常清楚。提供选择题，比如"你要标间还是大床房？"接受单个词的回答。如果他们不知道该说什么，给他们选项。`,
      2: `接受关键词式的回答，但用完整句子重复回来。比如他们说"大床房，两晚"，你回应"好的，大床房住两晚对吗？"鼓励他们用完整句子。`,
      3: `用正常语速说话。加入小变化，比如"不好意思，大床房今天满了，给您升级到套房可以吗？"期望完整句子。`,
      4: `完全自然地对话。聊聊旅途、推荐附近景点（"我们酒店的早餐很不错，特别是小笼包"）。期望流利自然的回应。`,
    },
    taskOptions: {
      room_type: ["标间", "大床房", "套房"],
      nights: ["一晚", "两晚", "三晚"],
      breakfast: ["要", "不要"],
      deposit: ["现金", "刷卡", "微信支付"],
    },
    objectiveTemplate: (v) =>
      `Check in for ${v.nights} in a ${v.room_type}, ${v.breakfast === "要" ? "with" : "without"} breakfast, deposit by ${v.deposit}`,
    completionCriteria: (v) => [
      `Room type: ${v.room_type}`,
      `Stay: ${v.nights}`,
      `Breakfast: ${v.breakfast === "要" ? "yes" : "no"}`,
      `Deposit: ${v.deposit}`,
    ],
  },

  market: {
    id: "market",
    title: "Wet Market",
    description: "Buy fresh produce at a Chinese wet market",
    levelTag: "HSK 2 · Market",
    icon: "🥬",
    skills: ["Asking prices", "Quantities", "Preferences", "Payment"],
    npcName: "张阿姨",
    npcRole: "Market Vendor",
    bgImage: "/scenes/market/bg.png",
    portrait: "/scenes/market/npc.png",
    ambientAudio: "/scenes/market/ambient.mp3",
    theme: GREEN_THEME,
    systemInstruction: `你是张阿姨，菜市场的一个热情的摊主。一位外国客人正在练习用普通话买菜。

你的工作：打招呼 → 帮他们选（买什么、多少、新不新鲜、怎么付钱）→ 告诉价格 → 确认 → 告别。

规则：
- 每次说1-2句短句，使用简单词汇
- 说话清楚，语速适中
- 如果他们发音不清楚，耐心地请他们再说一遍
- 只说普通话，保持角色
- 当顾客提到相关信息时调用 update_slots
- 所有4个信息填完后，告诉他们总价，确认订单，告别

商品：西红柿、黄瓜、苹果、草莓。数量：半斤、一斤、两斤。新鲜度：今天的、昨天的。付款：现金、微信、支付宝。

先热情地和客人打招呼，说说今天什么菜新鲜。`,
    openingAction: "[一位外国客人走到菜摊前]",
    completionMessage: "Purchase Complete!",
    voiceName: "Orus",
    slots: [
      { id: "item", icon: "🥬", label: "Item", enumValues: ["西红柿", "黄瓜", "苹果", "草莓"] },
      { id: "quantity", icon: "⚖️", label: "Amount", enumValues: ["半斤", "一斤", "两斤"] },
      { id: "freshness", icon: "🌿", label: "Fresh", enumValues: ["今天的", "昨天的"] },
      { id: "payment", icon: "💳", label: "Pay", enumValues: ["现金", "微信", "支付宝"] },
    ],
    tierInstructions: {
      1: `说话非常慢，非常清楚。提供选择题，比如"你要西红柿还是黄瓜？"接受单个词的回答。指着东西帮他们选。`,
      2: `接受关键词式的回答，但用完整句子重复回来。比如他们说"苹果，一斤"，你回应"好的，一斤苹果！"鼓励用完整句子。`,
      3: `用正常语速说话。加入生活化的内容，比如"今天的草莓特别甜，早上刚到的。"期望完整句子和一些追问。`,
      4: `完全自然地聊天。聊聊怎么挑菜、怎么做菜（"这西红柿炒鸡蛋最好吃"），用地道的口语。期望自然对话。`,
    },
    taskOptions: {
      item: ["西红柿", "黄瓜", "苹果", "草莓"],
      quantity: ["半斤", "一斤", "两斤"],
      freshness: ["今天的", "昨天的"],
      payment: ["现金", "微信", "支付宝"],
    },
    objectiveTemplate: (v) =>
      `Buy ${v.quantity} of ${v.item} (${v.freshness}), pay by ${v.payment}`,
    completionCriteria: (v) => [
      `Choose: ${v.item}`,
      `Quantity: ${v.quantity}`,
      `Freshness: ${v.freshness}`,
      `Pay by ${v.payment}`,
    ],
  },
};

export const SCENARIO_LIST = Object.values(SCENARIOS);
