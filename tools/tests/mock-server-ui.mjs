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

/**
 * Two-button popups: button1 is selection 0, button2 selection 1. The player's scripted choice
 * comes from formSelections (used up), else she is busy or closes it as player.formCancel says
 * (a FormCancelationReason, kept until the test changes it), else formSelection, else she closes it.
 */
export class MessageFormData {
  constructor() {
    this.titleText = '';
    this.bodyText = '';
    this.buttons = [];
  }
  title(text) {
    this.titleText = text;
    return this;
  }
  body(text) {
    this.bodyText = text;
    return this;
  }
  button1(text) {
    this.buttons[0] = text;
    return this;
  }
  button2(text) {
    this.buttons[1] = text;
    return this;
  }
  show(player) {
    player.forms?.push({ title: this.titleText, body: this.bodyText, buttons: [...this.buttons] });
    if (player.formSelections?.length) return Promise.resolve({ canceled: false, selection: player.formSelections.shift() });
    if (player.formCancel) return Promise.resolve({ canceled: true, cancelationReason: player.formCancel });
    const selection = player.formSelection;
    player.formSelection = undefined;
    return Promise.resolve(selection === undefined ? { canceled: true, cancelationReason: FormCancelationReason.UserClosed } : { canceled: false, selection });
  }
}

/** Modal forms: the player's scripted values (formValues), used up one form at a time. */
export class ModalFormData {
  constructor() {
    this.titleText = '';
    this.controls = [];
  }
  title(text) {
    this.titleText = text;
    return this;
  }
  toggle(label, options = {}) {
    this.controls.push({ type: 'toggle', label, value: options.defaultValue ?? false });
    return this;
  }
  dropdown(label, items, options = {}) {
    this.controls.push({ type: 'dropdown', label, items: [...items], value: options.defaultValueIndex ?? 0 });
    return this;
  }
  /** Text only: no value of its own. */
  label(text) {
    this.controls.push({ type: 'label', label: text });
    return this;
  }
  submitButton() {
    return this;
  }
  show(player) {
    player.forms?.push({ title: this.titleText, controls: this.controls.map((c) => ({ ...c })) });
    const values = player.formValues?.length ? player.formValues.shift() : undefined;
    return Promise.resolve(values === undefined ? { canceled: true, cancelationReason: FormCancelationReason.UserClosed } : { canceled: false, formValues: values });
  }
}
