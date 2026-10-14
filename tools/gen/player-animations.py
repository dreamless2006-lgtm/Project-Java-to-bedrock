# Port of dev.dixmk.minepreggo.client.animation.player.PlayerAnimations (the mod's procedural
# player body animations: birth, post-birth, miscarriage, water breaking, pre-birth, back pain,
# belly rubbing per phase, heavy walking per phase) to Bedrock Molang animations.
#
# Java sets absolute transforms on the vanilla PlayerModel's independent parts every frame.
# Bedrock's player geometry is a hierarchy (body -> head/arms, root -> legs), so head and arm
# transforms are converted into body-local ones, and "expr - this" makes a channel absolute
# (the trick vanilla's zombie arms use). Positions: Java y is down, Bedrock y is up.
#
# Usage: python3 tools/gen/player-animations.py <decompiled PlayerAnimations.java> > packs/resource/animations/player.animation.json
import json, math, re, sys

src = open(sys.argv[1]).read()
F = {'f_104200_': 'x', 'f_104201_': 'y', 'f_104202_': 'z', 'f_104203_': 'rx', 'f_104204_': 'ry', 'f_104205_': 'rz'}
BONES = {'body': 'body', 'head': 'head', 'right_arm': 'rightArm', 'left_arm': 'leftArm', 'right_leg': 'rightLeg', 'left_leg': 'leftLeg'}
DEFAULT = {'body': (0, 0, 0), 'head': (0, 0, 0), 'right_arm': (-5, 2, 0), 'left_arm': (5, 2, 0), 'right_leg': (-1.9, 12, 0), 'left_leg': (1.9, 12, 0)}
T = 'q.anim_time * 20'  # continuousAnimationTick

def osc(a, b, speed, offset='0.0'):
    """AnimationHelper.betweenAnglesMth: min + (max - min) * (sin(t * speed + offset) + 1) / 2 (degrees)."""
    return f'({a} + ({b} - ({a})) * (math.sin(({T} * {speed} + {offset}) * 57.2958) + 1.0) * 0.5)'

def to_molang(expr, rotation):
    """A Java expression (no 'part.' references) to Molang degrees / model units."""
    e = expr.replace('(float)', '').replace('(double)', '').replace('continuousAnimationTick', 'T')
    e = re.sub(r'(\d)F\b', r'\1', e)
    e = re.sub(r'\s+', ' ', e).strip()
    if rotation and re.fullmatch(r'\(?-?\d+(\.\d+)?\)?', e):  # a bare radians constant
        return str(round(math.degrees(float(e.strip('()'))), 3))
    e = e.replace('(-Math.PI / 2)', '(-90.0)').replace('(Math.PI / 2)', '(90.0)')
    e = re.sub(r'Math\.toRadians\(([-\d.]+)\)', r'(\1)', e)
    e = re.sub(r'AnimationHelper\.betweenAnglesMth\(([-\d.]+), ([-\d.]+), T, ([-\d.]+)(?:, ([-\d.]+))?\)',
               lambda m: osc(m.group(1), m.group(2), m.group(3), m.group(4) or '0.0'), e)
    return e

def parse(block):
    parts = {}
    for m in re.finditer(r'addPartAnimation\(\s*"(\w+)",\s*\(part, continuousAnimationTick\) -> (\{.*?\}|[^;]*;)\s*\)', block, re.S):
        part, body = m.group(1), m.group(2)
        if part not in BONES:
            continue
        stmts = {}
        for f, op, expr in re.findall(r'part\.(f_\d+_)\s*(\+=|=)\s*([^;]+);', body):
            chan = F[f]
            rotation = chan.startswith('r')
            expr = expr.replace('(float)', '').replace('(double)', '').strip()
            rel = re.fullmatch(r'\(?\s*part\.' + f + r'\s*([+-])\s*(.*)', expr)
            if op == '+=':
                stmts[chan] = ('rel', to_molang(expr, rotation))
            elif rel:
                inner = rel.group(2).strip()
                if expr.startswith('(') and inner.endswith(')'):
                    inner = inner[:-1]
                value = to_molang(inner, rotation)
                stmts[chan] = ('rel', value if rel.group(1) == '+' else f'-({value})')
            else:
                stmts[chan] = ('abs', to_molang(expr, rotation))
        parts[part] = stmts
    return parts

out = {}
for block in re.split(r'public static final PlayerAnimation ', src)[1:]:
    name = block.split(' ')[0].lower()
    parts = parse(block)
    body = parts.get('body', {})
    body_rx = body.get('rx')
    lying = body_rx is not None and body_rx[0] == 'abs' and body_rx[1] in ('-90.0', '(-90.0)')
    body_pos = [float(body[c][1]) if c in body and body[c][0] == 'abs' else 0.0 for c in 'xyz']
    bones = {}
    for part, stmts in parts.items():
        child = part in ('head', 'right_arm', 'left_arm')
        rot = {c: stmts.get('r' + c) for c in 'xyz'}
        entry = {}
        if any(rot.values()):
            if part == 'head':
                # vanilla keeps the head entity-relative (look_at_target), so Java's absolute values apply as they are
                r = [f'({v[1]}) - this' if v and v[0] == 'abs' else (f'({v[1]})' if v else 0.0) for v in (rot['x'], rot['y'], rot['z'])]
                entry['relative_to'] = {'rotation': 'entity'}
            elif child and lying:
                # arms share the body's -90 pitch: local = Rx(90)·Rz(c)·Ry(b)·Rx(-90) ≈ (0, -c, b)
                b = rot['y'][1] if rot['y'] else '0.0'
                c = rot['z'][1] if rot['z'] else '0.0'
                r = ['0.0 - this', f'-({c}) - this', f'({b}) - this']
            else:
                r = []
                for axis in 'xyz':
                    v = rot[axis]
                    if not v:
                        r.append(0.0)
                    elif v[0] == 'rel':
                        r.append(f'({v[1]})')
                    elif child and axis == 'x' and body_rx and body_rx[0] == 'abs':
                        r.append(f'({v[1]}) - ({body_rx[1]}) - this')  # absolute pitch minus the body's
                    else:
                        r.append(f'({v[1]}) - this')
            entry['rotation'] = r
        pos = {c: stmts.get(c) for c in 'xyz'}
        if any(pos.values()):
            d = DEFAULT[part]
            want = [float(pos[c][1]) if pos[c] else d[i] for i, c in enumerate('xyz')]
            if child:
                bx = math.radians(-90.0) if lying else 0.0
                placed = [body_pos[0] + d[0], body_pos[1] + d[1] * math.cos(bx) - d[2] * math.sin(bx), body_pos[2] + d[1] * math.sin(bx) + d[2] * math.cos(bx)]
                delta = [want[i] - placed[i] for i in range(3)]
                ly = delta[1] * math.cos(-bx) - delta[2] * math.sin(-bx)
                lz = delta[1] * math.sin(-bx) + delta[2] * math.cos(-bx)
                delta = [delta[0], ly, lz]
            else:
                delta = [want[i] - d[i] for i in range(3)]
            bed = [round(delta[0], 3), round(-delta[1], 3), round(delta[2], 3)]
            if any(abs(v) > 1e-6 for v in bed):
                entry['position'] = [f'{v} - this' for v in bed]
        if entry:
            bones[BONES[part]] = entry
    out[f'animation.minepreggo.player.{name}'] = {'loop': True, 'bones': bones}

print(json.dumps({'format_version': '1.8.0', 'animations': out}, indent=2))
