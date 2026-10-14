// Minimal server-ui mock: forms record their calls and resolve as cancelled unless a script answers.
export const forms = { shown: [], answer: null };
class Form {
    constructor(kind) { this.kind = kind; this.calls = []; }
    show(player) { forms.shown.push({ kind: this.kind, player: player?.name, calls: this.calls }); const a = forms.answer; forms.answer = null; return Promise.resolve(a || { canceled: true }); }
}
for (const m of ["title", "body", "button", "divider", "header", "label", "dropdown", "slider", "textField", "toggle", "submitButton", "button1", "button2"]) {
    Form.prototype[m] = function (...args) { this.calls.push([m, ...args]); return this; };
}
export class ActionFormData extends Form { constructor() { super("action"); } }
export class ModalFormData extends Form { constructor() { super("modal"); } }
export class MessageFormData extends Form { constructor() { super("message"); } }
