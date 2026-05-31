export type Lang = "en" | "zh";

const en = {
  header: {
    active: (n: number) => `${n} active`,
  },
  urlInput: {
    placeholder: "Paste YouTube URL to start",
    clearUrl: "Clear URL",
    model: "Whisper medium · Claude Haiku",
    starting: "Starting…",
    startProcessing: "Start Processing",
  },
  onboarding: [
    {
      label: "Paste a URL",
      desc: "YouTube video link above. TubePilot fetches the video and metadata.",
    },
    {
      label: "Auto-transcribe",
      desc: "Whisper generates an accurate EN transcript. No manual editing needed.",
    },
    {
      label: "Translate + review",
      desc: "AI translates to ZH-CN. You review in the subtitle editor before publishing.",
    },
    {
      label: "Publish",
      desc: "One click to Bilibili with title, description, cover, and bilingual subtitles.",
    },
  ],
  stages: {
    labels: ["Fetch", "Transcribe", "Translate", "Review", "Publish"],
    verbs: ["Fetching", "Transcribing", "Translating", "Reviewing", "Publishing"],
  },
  status: {
    readyForReview: "Ready for review",
    failed: (stage: string) => `Failed · ${stage}`,
    published: "Published",
    done: "DONE",
    error: "ERROR",
    cancelled: "CANCELLED",
  },
  actions: {
    review: "Review",
    cancel: "Cancel",
    confirmCancel: "Sure?",
    retry: "Retry",
    reRun: "Re-run",
    retryAll: "↺ Retry all",
    clear: "Clear",
    confirmClear: "Sure?",
  },
  sections: {
    inProgress: "In Progress",
    history: "History",
  },
  filter: {
    allStatus: "All status",
    done: "Done",
    error: "Error",
    cancelled: "Cancelled",
    allTime: "All time",
    today: "Today",
    thisWeek: "This week",
    thisMonth: "This month",
    allChannels: "All channels",
    searchPlaceholder: "Filter titles...",
    clearSearch: "Clear search",
    clearAll: "Clear all",
    removeFilter: (label: string) => `Remove ${label} filter`,
    chipToday: "today",
    chipThisWeek: "this week",
    chipThisMonth: "this month",
  },
  dateGroups: {
    today: "TODAY",
    week: "THIS WEEK",
    month: "THIS MONTH",
    earlier: "EARLIER",
  },
  empty: {
    noHistory: "No history yet",
    noMatch: "No jobs match these filters.",
    clearFilters: "Clear filters",
  },
  aria: {
    switchToChinese: "Switch to Chinese",
    switchToEnglish: "Switch to English",
    switchToLight: "Switch to light mode",
    switchToDark: "Switch to dark mode",
  },
};

const zh: typeof en = {
  header: {
    active: (n: number) => `${n} 个进行中`,
  },
  urlInput: {
    placeholder: "粘贴 YouTube 链接开始",
    clearUrl: "清除链接",
    model: "Whisper medium · Claude Haiku",
    starting: "处理中…",
    startProcessing: "开始处理",
  },
  onboarding: [
    {
      label: "粘贴链接",
      desc: "将 YouTube 链接粘贴至上方输入框。TubePilot 自动抓取视频和元数据。",
    },
    {
      label: "自动转录",
      desc: "Whisper 生成精准英文字幕，无需人工干预。",
    },
    {
      label: "翻译与审校",
      desc: "AI 将字幕翻译为中文，在字幕编辑器中确认后发布。",
    },
    {
      label: "发布",
      desc: "一键发布至 Bilibili，携带标题、简介、封面和双语字幕。",
    },
  ],
  stages: {
    labels: ["抓取", "转录", "翻译", "审校", "发布"],
    verbs: ["抓取中", "转录中", "翻译中", "审校中", "发布中"],
  },
  status: {
    readyForReview: "待审校",
    failed: (stage: string) => `失败 · ${stage}`,
    published: "已发布",
    done: "完成",
    error: "错误",
    cancelled: "已取消",
  },
  actions: {
    review: "去审校",
    cancel: "取消",
    confirmCancel: "确认？",
    retry: "重试",
    reRun: "重新处理",
    retryAll: "↺ 全部重试",
    clear: "清除",
    confirmClear: "确认？",
  },
  sections: {
    inProgress: "进行中",
    history: "历史",
  },
  filter: {
    allStatus: "全部状态",
    done: "已完成",
    error: "失败",
    cancelled: "已取消",
    allTime: "全部时间",
    today: "今天",
    thisWeek: "本周",
    thisMonth: "本月",
    allChannels: "全部频道",
    searchPlaceholder: "搜索标题…",
    clearSearch: "清除搜索",
    clearAll: "清除全部",
    removeFilter: (label: string) => `移除"${label}"筛选`,
    chipToday: "今天",
    chipThisWeek: "本周",
    chipThisMonth: "本月",
  },
  dateGroups: {
    today: "今天",
    week: "本周",
    month: "本月",
    earlier: "更早",
  },
  empty: {
    noHistory: "暂无历史记录",
    noMatch: "没有符合条件的记录。",
    clearFilters: "清除筛选",
  },
  aria: {
    switchToChinese: "切换为中文",
    switchToEnglish: "切换为英文",
    switchToLight: "切换为浅色主题",
    switchToDark: "切换为深色主题",
  },
};

export const translations = { en, zh } as const;
export type Translations = typeof en;
