// Stand-in for @minecraft/server-ui: forms resolve at once with the player's scripted choice.
export const FormCancelationReason = { UserBusy: 'UserBusy', UserClosed: 'UserClosed' };

export class ActionFormData {
  constructor() {
    this.buttons = [];
    this.titleText = '';
    this.bodyText = '';
  }
  title(text) {
    this.titleText = text;
    return this;
  }
  body(text) {
    this.bodyText = text;
    return this;
  }
  button(label) {
    this.buttons.push(label);
    return this;
  }
  /** Resolves with the player's scripted choice, which is used up (a second form in a row is closed). */
  show(player) {
    player.forms?.push({ title: this.titleText, body: this.bodyText, buttons: [...this.buttons] });
    const selection = player.formSelections?.length ? player.formSelections.shift() : player.formSelection;
    player.formSelection = undefined;
    return Promise.resolve(selection === undefined ? { canceled: true, cancelationReason: FormCancelationReason.UserClosed } : { canceled: false, selection });
  }
}
