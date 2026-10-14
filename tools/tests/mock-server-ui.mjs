// Stand-in for @minecraft/server-ui: forms resolve at once with the player's scripted choice.
export const FormCancelationReason = { UserBusy: 'UserBusy', UserClosed: 'UserClosed' };

export class ActionFormData {
  constructor() {
    this.buttons = [];
  }
  title() {
    return this;
  }
  body() {
    return this;
  }
  button(label) {
    this.buttons.push(label);
    return this;
  }
  show(player) {
    const selection = player.formSelection;
    return Promise.resolve(selection === undefined ? { canceled: true, cancelationReason: FormCancelationReason.UserClosed } : { canceled: false, selection });
  }
}
