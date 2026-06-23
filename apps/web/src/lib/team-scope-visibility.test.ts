import { describe, it, expect } from "vitest";
import { hideTeamScopeUi } from "./team-scope-visibility";

describe("hideTeamScopeUi", () => {
  it("shows team UI in a loaded team project (company profile)", () => {
    expect(
      hideTeamScopeUi({
        isPersonal: false,
        projectHasTeam: true,
        projectLoading: false,
      }),
    ).toBe(false);
  });

  it("hides team UI in a personal project (no team)", () => {
    expect(
      hideTeamScopeUi({
        isPersonal: false,
        projectHasTeam: false,
        projectLoading: false,
      }),
    ).toBe(true);
  });

  it("hides team UI for a personal profile even in a team project", () => {
    expect(
      hideTeamScopeUi({
        isPersonal: true,
        projectHasTeam: true,
        projectLoading: false,
      }),
    ).toBe(true);
  });

  it("hides team UI while the project is still loading (avoids flicker)", () => {
    // projectHasTeam defaults false during load — without the loading
    // guard a team project would still be hidden here; the guard makes
    // the intent explicit and survives a future default change.
    expect(
      hideTeamScopeUi({
        isPersonal: false,
        projectHasTeam: true,
        projectLoading: true,
      }),
    ).toBe(true);
  });

  it("treats omitted projectLoading as not-loading", () => {
    expect(
      hideTeamScopeUi({ isPersonal: false, projectHasTeam: true }),
    ).toBe(false);
  });
});
