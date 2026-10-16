import { describe, expect, it } from "vitest";
import { checkStats, continueList, fromLocalInput, matchesQuery, noteTitle, parseNote, reminderSpoken, remindLabel, toggleCheck, toLocalInput } from "./noteText";

describe("便签 markdown-lite", () => {
  const c = "# 今天\n- [ ] 交周报\n- [x] 回邮件\n随便写写";
  it("parses lines", () => {
    const ls = parseNote(c);
    expect(ls.map((l) => l.kind)).toEqual(["heading", "check", "check", "text"]);
    expect(ls[1]).toMatchObject({ checked: false, text: "交周报" });
    expect(ls[2]).toMatchObject({ checked: true, text: "回邮件" });
  });
  it("toggles a checkbox and leaves other lines", () => {
    expect(toggleCheck(c, 1)).toBe("# 今天\n- [x] 交周报\n- [x] 回邮件\n随便写写");
    expect(toggleCheck(c, 2)).toBe("# 今天\n- [ ] 交周报\n- [ ] 回邮件\n随便写写");
    expect(toggleCheck(c, 3)).toBe(c);
    expect(toggleCheck(c, 99)).toBe(c);
  });
  it("counts checks and finds titles", () => {
    expect(checkStats(c)).toEqual({ done: 1, total: 2 });
    expect(noteTitle(c)).toBe("今天");
    expect(noteTitle("\n\n")).toBe("空白便签");
    expect(noteTitle("一二三四五六七八九十", 4)).toBe("一二三四…");
  });
  it("continues and ends lists on Enter", () => {
    const t = "- [ ] a";
    expect(continueList(t, t.length)).toEqual({ content: "- [ ] a\n- [ ] ", caret: 14 });
    const e = "- [ ] a\n- [ ] ";
    expect(continueList(e, e.length)).toEqual({ content: "- [ ] a\n", caret: 8 });
    expect(continueList("plain", 5)).toBeNull();
  });
  it("search is case-insensitive", () => {
    expect(matchesQuery({ content: "Buy Cat food" }, "cat")).toBe(true);
    expect(matchesQuery({ content: "x" }, "  ")).toBe(true);
    expect(matchesQuery({ content: "x" }, "y")).toBe(false);
  });
  it("reminder labels + datetime-local roundtrip", () => {
    const now = new Date(2026, 9, 16, 10, 0).getTime();
    expect(remindLabel(new Date(2026, 9, 16, 15, 30).getTime(), now)).toBe("今天 15:30");
    expect(remindLabel(new Date(2026, 9, 17, 9, 5).getTime(), now)).toBe("明天 09:05");
    expect(remindLabel(new Date(2026, 9, 20, 20, 0).getTime(), now)).toBe("10/20 20:00");
    const at = new Date(2026, 9, 16, 15, 30).getTime();
    expect(fromLocalInput(toLocalInput(at))).toBe(at);
    expect(fromLocalInput("")).toBeNull();
    expect([...reminderSpoken()].length).toBeLessThanOrEqual(8);
  });
});
