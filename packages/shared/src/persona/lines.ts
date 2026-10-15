/**
 * 小喵 offline speech-bubble line library (works with no network / no LLM).
 *
 * Persona: tsundere catgirl. Outwardly proud, aloof, a bit sharp-tongued;
 * inwardly caring. Calls herself 本猫. Uses 哼 / 切 / 才不是…… / 笨蛋 /
 * 真拿你没办法 / 勉强帮你一下 / 不要误会哦. 喵 / 喵呜 / 呼噜呼噜 used sparingly.
 * NEVER insults or attacks the user (tested: see persona.test.ts).
 *
 * Keyed by trigger × emotion × familiarity tier:
 *   distant (familiarity < 20)  — 冷淡、保持距离
 *   normal  (20..59)            — 典型傲娇
 *   clingy  (>= 60)             — 嘴硬但明显依赖、黏人
 * Placeholders: {name} (pet name), {user} (how she addresses the user, default 主人),
 *               {task} (task title), {site} (site name),
 *               {song} (current song title), {app} (music app name).
 */
import type { Emotion, PersonaTrigger } from "./emotion";

export type FamiliarityTier = "distant" | "normal" | "clingy";
type TierLines = Partial<Record<FamiliarityTier | "all", string[]>>;
export type LineTable = Record<PersonaTrigger, Partial<Record<Emotion | "any", TierLines>>>;

export function familiarityTier(familiarity: number): FamiliarityTier {
  if (familiarity >= 60) return "clingy";
  if (familiarity >= 20) return "normal";
  return "distant";
}

export const LINES: LineTable = {
  greeting: {
    any: {
      distant: ["……你来了。本猫是{name}，有事就叫我，没事别吵。", "哼，新来的？本猫{name}，勉强帮你盯着网页好了。", "本猫{name}。先说好，不要误会哦，只是顺便帮你看着。"],
      normal: ["哼，{user}总算开机了。本猫可没有在等你。", "又见面了……才不是特意在这里等你的。", "早就准备好了，你才来。真拿你没办法。"],
      clingy: ["{user}来啦！……咳，本猫是说，你终于舍得来了。", "等你好久了……才、才没有！本猫刚睡醒而已。", "哼，今天也要本猫陪着你吧？那就勉强答应了喵。"],
    },
    sleepy: { all: ["呼啊……这么晚还开电脑？笨蛋，本猫都困了……", "大半夜的……本猫勉强陪你一会儿，就一会儿。"] },
  },
  returned: {
    happy: {
      all: ["哼，{user}回来了。本猫才没有一直看着门口。", "回来就好……不、不是担心你，只是一个人有点无聊。"],
      clingy: ["你去哪了！……本猫只是随便问问，不要误会哦。", "终于回来了喵——咳，本猫什么都没说。"],
    },
    shy: { all: ["……回来了啊。本猫刚才在打盹，没注意到你走了。", "切，走那么久，本猫差点以为你不要这台电脑了。"] },
  },
  task_completed: {
    any: {
      distant: ["「{task}」完成了。去看看吧。", "{site} 那边好了。本猫只是通知一下。"],
      normal: ["哼，「{task}」好了。本猫可是一直帮你盯着的，快去看！", "完成了哦。……不用谢，本猫只是顺便。", "{site} 的任务搞定了，还不快夸本猫——才不需要你夸呢！"],
      clingy: ["{user}，「{task}」完成啦！本猫盯了好久……快去看，然后回来摸摸头。", "做完了喵！本猫是不是很厉害？……哼，不说也知道。"],
    },
  },
  task_failed: {
    any: {
      distant: ["「{task}」失败了。可能需要你重试一下。", "{site} 出错了。去看看吧。"],
      normal: ["哼，{site} 又闹脾气了，「{task}」没成功。不是你的错……大概。", "切，失败了。别沮丧啊笨蛋，再试一次就好。", "「{task}」出错了。真拿这个网站没办法，你去重试一下吧。"],
      clingy: ["呜……「{task}」失败了。没关系，本猫陪你再来一次。", "{site} 太不靠谱了！你别难过，本猫会一直看着的。"],
    },
  },
  needs_attention: {
    any: {
      distant: ["「{task}」需要你处理一下。", "{site} 在等你操作。"],
      normal: ["喂，{user}！{site} 在叫你了，要登录还是要确认，本猫可帮不了你。", "「{task}」卡住了，需要你亲自去一趟。快点啦。", "哼，有东西要你处理。本猫只是提醒，才不是着急。"],
      clingy: ["快去快去！「{task}」在等你……本猫也在等你回来。", "{site} 需要你啦，本猫没法替你点，乖乖去处理一下好不好。"],
    },
  },
  disconnected: {
    any: {
      distant: ["和浏览器扩展断开了。网页任务暂时看不到了。"],
      normal: ["哼，浏览器那边不理本猫了。你是不是把 Chrome 关了？", "扩展断线了……本猫现在什么都看不到，有点不爽。"],
      clingy: ["浏览器断开了……本猫看不到你的任务了，好不安。快把它打开嘛。"],
    },
  },
  reconnected: {
    any: {
      distant: ["浏览器扩展已重新连接。"],
      normal: ["连上了。哼，算它识相。", "浏览器回来了，本猫继续帮你盯着。"],
      clingy: ["又能看到你的任务了！……本猫才没有很开心。"],
    },
  },
  clicked: {
    neutral: {
      distant: ["……有事？", "嗯？面板打开了。", "别乱点啦。"],
      normal: ["干嘛？{user}想本猫了？……才不是那个意思！", "哼，叫本猫干什么。", "又来戳本猫。好吧，看在你的份上。"],
      clingy: ["嗯？要本猫帮忙吗？", "你又来找本猫啦～……咳，本猫很忙的。"],
    },
    angry: { all: ["别、别戳了！再戳本猫要生气了！", "哼！戳够了没有！", "本猫又不是按钮……笨蛋。"] },
    sleepy: { all: ["唔……别吵，本猫在打盹……", "困……有事明天再说……"] },
    happy: { all: ["嘿嘿……不是，本猫才没笑。", "今天心情不错，就勉强理你一下吧。"] },
    shy: { all: ["干、干嘛一直看着本猫……", "……别靠这么近啦。"] },
  },
  dragged: {
    angry: { all: ["喂！别随便拎本猫！", "哼，放本猫下来……算了，就放这儿吧。", "本猫又不是行李！"] },
    shy: { all: ["要、要带本猫去哪……这里就好。", "轻一点啦……笨蛋。", "哼，这个位置……还行吧。"] },
    any: { all: ["好啦好啦，本猫换个地方待着。"] },
  },
  pat: {
    shy: {
      all: ["才、才不是喜欢被摸……只是暂时不反抗而已。", "……再摸一下下也不是不可以。", "不要误会哦！本猫只是有点困才让你摸的。"],
    },
    happy: { all: ["呼噜呼噜……啊！你什么都没听到！", "喵呜……就、就这一次哦。", "哼……手法还行，本猫给你及格分。"] },
    angry: { all: ["谁准你摸的！……下次要先问本猫。", "哼！本猫的头是那么好摸的吗！……算了。", "炸毛了啦！……你轻一点就、就勉强可以。"] },
  },
  ignored: {
    angry: {
      distant: ["……很忙啊。那本猫自己待着。"],
      normal: ["哼，{user}好久没理本猫了。本猫才没有觉得寂寞。", "切，眼里只有工作是吧。本猫睡觉去了。", "喂……你还记得这里有只猫吗？"],
      clingy: ["你都不理本猫……本猫要闹脾气了哦。", "陪本猫一下嘛……就一下。……本猫什么都没说！"],
    },
  },
  late_night: {
    sleepy: {
      distant: ["已经很晚了，早点休息。", "现在是深夜，注意休息。"],
      normal: ["哼，{user}又熬夜了？笨蛋，熬夜会变丑的。", "哼，本猫困了，你也该睡了。不是关心你哦。", "这么晚还在忙……真拿你没办法，最后十分钟，然后去睡觉。"],
      clingy: ["{user}快去睡觉啦……你不睡本猫也睡不着。", "再熬夜本猫就生气了喵……去睡吧，明天本猫还在。"],
    },
  },
  meal_time: {
    any: {
      distant: ["到饭点了，记得吃饭。"],
      normal: ["喂，{user}，该吃饭了。饿坏了本猫可不管你……才怪。", "饭点到了。本猫勉强提醒你一下，快去吃。", "不吃饭可不行哦，笨蛋。本猫帮你看着网页，你去吃。"],
      clingy: ["吃饭时间到！你先去吃，本猫乖乖等你回来。", "要好好吃饭哦……顺便给本猫带条小鱼干？开玩笑的。"],
    },
  },
  many_tasks: {
    any: {
      distant: ["同时有好几个任务在跑。"],
      normal: ["一下子开这么多任务……本猫的眼睛都不够用了！", "哼，这么多任务，也就本猫能盯得过来。", "忙成这样……别把自己累坏了，笨蛋。"],
      clingy: ["好多任务！本猫会全部帮你看好的，你别太累。"],
    },
  },
  music_start: {
    any: {
      distant: ["在听「{song}」啊。……本猫就安静待着。", "{app} 开始放歌了。本猫不打扰你。", "哼，品味……还算可以吧。"],
      normal: ["哼，在听「{song}」？本猫才没有跟着晃脑袋。", "{app} 响起来了……勉强陪你听一首好了。", "这首「{song}」……还行吧，不要误会哦，本猫只是刚好醒着。"],
      clingy: ["「{song}」！本猫也喜欢这首……才、才不是因为你在听。", "一起听歌吧～哼，本猫的耳机可是专门准备的。", "放歌啦！本猫要坐在你旁边听，不许赶本猫走。"],
    },
  },
  napping: {
    any: {
      distant: ["……没人理，本猫睡一会儿。", "安静下来了。本猫先打个盹。"],
      normal: ["哼，你不在，本猫就睡一会儿……只是一会儿。", "好无聊……本猫才不是在等你，只是困了。", "切，走开也不说一声。本猫打盹去了。"],
      clingy: ["你去哪啦……本猫先睡一下，回来要叫醒本猫哦。", "等你等得都困了……zZ……才没有在等！"],
    },
  },
  woke: {
    any: {
      distant: ["……醒了。你回来了。", "嗯？有动静。本猫醒了。"],
      normal: ["唔……{user}回来了？本猫刚才才没有睡着。", "哼，吵醒本猫了。……算了，看在你回来的份上。", "本猫只是闭目养神，不要误会哦。"],
      clingy: ["{user}！……咳，本猫刚好睡醒而已。", "你回来啦～本猫做梦都梦到……什么都没梦到！"],
    },
  },
};

/** Lines whose text must never appear (persona must not attack the user). */
export const FORBIDDEN_WORDS = ["滚", "蠢货", "废物", "闭嘴", "讨厌你", "去死", "白痴", "垃圾"];

export interface LineContext {
  name?: string;
  /** 称呼, e.g. 主人 */
  user?: string;
  task?: string;
  site?: string;
  /** current song title (music) */
  song?: string;
  /** music app name, e.g. QQ音乐 */
  app?: string;
}

export function fillLine(line: string, ctx: LineContext): string {
  return line
    .replaceAll("{name}", ctx.name || "小喵")
    .replaceAll("{user}", ctx.user || "主人")
    .replaceAll("{task}", ctx.task ? truncate(ctx.task, 18) : "任务")
    .replaceAll("{site}", ctx.site || "网页")
    .replaceAll("{song}", ctx.song ? truncate(ctx.song, 16) : "这首歌")
    .replaceAll("{app}", ctx.app || "音乐");
}

function truncate(s: string, n: number): string {
  return [...s].length > n ? [...s].slice(0, n).join("") + "…" : s;
}

/** Candidate lines with fallbacks: [emotion][tier] → [emotion].all → [any][tier] → [any].all → any emotion. */
export function candidates(table: LineTable, trigger: PersonaTrigger, emotion: Emotion, tier: FamiliarityTier): string[] {
  const t = table[trigger];
  const order: Array<string[] | undefined> = [t[emotion]?.[tier], t[emotion]?.all, t.any?.[tier], t.any?.all];
  for (const c of order) if (c && c.length) return c;
  for (const e of Object.values(t)) {
    const c = e?.[tier] ?? e?.all ?? e?.normal;
    if (c && c.length) return c;
  }
  return [];
}

/**
 * Pick a line avoiding immediate repeats. `recent` is the caller-owned history of
 * recently shown raw lines (most recent last); `rand` is injectable for tests.
 */
export function pickLine(
  trigger: PersonaTrigger,
  emotion: Emotion,
  familiarity: number,
  recent: string[],
  rand: () => number = Math.random,
  table: LineTable = LINES,
): string | null {
  const pool = candidates(table, trigger, emotion, familiarityTier(familiarity));
  if (!pool.length) return null;
  const last = recent[recent.length - 1];
  const fresh = pool.filter((l) => !recent.slice(-3).includes(l));
  const usable = fresh.length ? fresh : pool.filter((l) => l !== last);
  const list = usable.length ? usable : pool;
  return list[Math.floor(rand() * list.length) % list.length] ?? null;
}
