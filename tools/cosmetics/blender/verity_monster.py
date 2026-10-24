"""Turns the Verity Monster model (Verity Monster(TM) by GranDussek, CC BY 4.0,
https://sketchfab.com/3d-models/verity-monstertm-3ec67a929c054883bc7a6b6fc7ac8382) into Verity's
monster form: art/verity/monster.png (its picture) and art/verity/monster.json (its parts).

  blender -b --python tools/cosmetics/blender/verity_monster.py -- <verity_monstertm.glb>

The model comes rigged (a Mixamo skeleton) in a T-pose. The arms are posed down with that rig,
the mesh is lightened, and every triangle goes to the part of the body its bones move (head, body,
arms, legs), so the game can swing them like a player's: each part is a mesh around its joint,
with the picture's coordinates. Triangles near a joint go to both sides, so no gap opens when a
limb swings.
"""
import base64
import json
import math
import os
import struct
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HEIGHT = 44  # pixels (16 to a block): a little taller than a player
DECIMATE = 0.4
TEXTURE = 1024
ARM_DOWN = 14  # degrees out from straight down
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'art', 'verity')

# which part of the body each bone moves
ROLES = {
    'head': ('Neck', 'Head', 'HeadTop_End'),
    'armL': ('LeftArm', 'LeftForeArm', 'LeftHand'),
    'armR': ('RightArm', 'RightForeArm', 'RightHand'),
    'legL': ('LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToe'),
    'legR': ('RightUpLeg', 'RightLeg', 'RightFoot', 'RightToe'),
}
FRINGE = 0.3  # a triangle also goes to a limb if one of its corners is this much moved by it


def role_of(bone):
    name = bone.split(':')[-1].rsplit('_', 1)[0]
    for role, prefixes in ROLES.items():
        if any(name.startswith(p) for p in prefixes):
            return role
    return 'body'


def main():
    glb = sys.argv[sys.argv.index('--') + 1]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and not o.vertex_groups:
            bpy.data.objects.remove(o)  # a stray sphere
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    body = next(o for o in bpy.data.objects if o.type == 'MESH')
    # its standing T-pose is its one-frame animation (the rest pose lies flat): keep that pose
    act = arm.animation_data.action if arm.animation_data else None
    if act:
        bpy.context.scene.frame_set(round(act.frame_range[0]))
    standing = {pb.name: pb.matrix.copy() for pb in arm.pose.bones}
    arm.animation_data_clear()
    for pb in sorted(arm.pose.bones, key=lambda b: len(b.parent_recursive)):
        pb.matrix = standing[pb.name]
        bpy.context.view_layer.update()

    # the arms down at its sides
    A = arm.matrix_world
    for side in ('Left', 'Right'):
        pb = next(b for b in arm.pose.bones if b.name.split(':')[-1].startswith(side + 'Arm_'))
        head_w = A @ pb.head
        hand = next(b for b in arm.pose.bones if b.name.split(':')[-1].startswith(side + 'Hand_'))
        d = ((A @ hand.head) - head_w).normalized()
        s = 1 if d.x > 0 else -1
        t = Vector((s * math.sin(math.radians(ARM_DOWN)), 0, -math.cos(math.radians(ARM_DOWN))))
        q = d.rotation_difference(t)
        R = Matrix.Translation(head_w) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head_w)
        pb.matrix = A.inverted() @ R @ A @ pb.matrix
        bpy.context.view_layer.update()

    # bake the pose, join split corners, lighten
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    for m in body.modifiers:
        if m.type == 'ARMATURE':
            bpy.ops.object.modifier_apply(modifier=m.name)
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(me)
    bm.free()
    dec = body.modifiers.new('dec', 'DECIMATE')
    dec.ratio = DECIMATE
    bpy.ops.object.modifier_apply(modifier=dec.name)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()

    if os.environ.get('SAVE_BLEND'):
        bpy.ops.wm.save_as_mainfile(filepath=os.environ['SAVE_BLEND'])
    # into the game's space: y up, facing +z, feet at 0, in pixels
    W = body.matrix_world
    world = [W @ v.co for v in me.vertices]
    lo = Vector([min(p[i] for p in world) for i in range(3)])
    hi = Vector([max(p[i] for p in world) for i in range(3)])
    scale = HEIGHT / (hi.z - lo.z)
    mid = (lo + hi) / 2

    def game(p):
        return Vector(((p.x - mid.x) * scale, (p.z - lo.z) * scale, -(p.y - mid.y) * scale))

    N = W.to_3x3().inverted().transposed()

    def game_n(n):
        n = (N @ n).normalized()
        return Vector((n.x, n.z, -n.y))

    # the joints
    def joint(name):
        pb = next(b for b in arm.pose.bones if b.name.split(':')[-1].startswith(name + '_'))
        return game(A @ pb.head)

    joints = {
        'body': joint('Hips'), 'head': joint('Neck'),
        'armL': joint('LeftArm'), 'armR': joint('RightArm'),
        'legL': joint('LeftUpLeg'), 'legR': joint('RightUpLeg'),
    }
    # the game's left limbs are the ones at +x (facing +z); this rig names them the other way round
    swap = {'armL': 'armR', 'armR': 'armL', 'legL': 'legR', 'legR': 'legL'}
    flip = joints['armL'].x < joints['armR'].x
    if flip:
        joints = {swap.get(r, r): p for r, p in joints.items()}

    roles = {g.index: (swap.get(role_of(g.name), role_of(g.name)) if flip else role_of(g.name)) for g in body.vertex_groups}
    weights = []
    for v in me.vertices:
        w = {}
        for ge in v.groups:
            r = roles.get(ge.group)
            if r:
                w[r] = w.get(r, 0) + ge.weight
        tot = sum(w.values()) or 1
        weights.append({r: x / tot for r, x in w.items()})

    uv = me.uv_layers.active.data
    parts = {r: {'verts': {}, 'data': [], 'tri': []} for r in joints}

    def add(role, li, vi):
        P = parts[role]
        u, v = uv[li].uv
        key = (vi, round(u, 5), round(v, 5))
        if key not in P['verts']:
            p = game(W @ me.vertices[vi].co) - joints[role]
            n = game_n(me.vertices[vi].normal)
            P['verts'][key] = len(P['data'])
            P['data'].append((p, n, u, 1 - v))
        return P['verts'][key]

    counts = {r: 0 for r in joints}
    for poly in me.polygons:
        corners = list(zip(poly.loop_indices, poly.vertices))
        avg = {}
        for _, vi in corners:
            for r, x in weights[vi].items():
                avg[r] = avg.get(r, 0) + x / 3
        main_role = max(avg, key=avg.get) if avg else 'body'
        to = {main_role}
        for r in ('armL', 'armR', 'legL', 'legR', 'head'):
            if any(weights[vi].get(r, 0) >= FRINGE for _, vi in corners):
                to.add(r)
        for r in to:
            parts[r]['tri'].append([add(r, li, vi) for li, vi in corners])
            counts[r] += 1

    out = {'h': HEIGHT, 'parts': {}}
    for r, P in parts.items():
        if len(P['data']) > 65535:
            raise SystemExit(f'{r}: too many corners')
        vb = bytearray()
        for p, n, u, v in P['data']:
            vb += struct.pack('<hhhbbbBBBHH', *(max(-32768, min(32767, round(c * 64))) for c in p),
                              *(max(-127, min(127, round(c * 127))) for c in n), 255, 255, 255,
                              max(0, min(65535, round(u * 65535))), max(0, min(65535, round(v * 65535))))
        ib = struct.pack(f'<{len(P["tri"]) * 3}H', *(i for t in P['tri'] for i in t))
        out['parts'][r] = {'p': [round(c, 2) for c in joints[r]], 'n': len(P['data']),
                           'v': base64.b64encode(bytes(vb)).decode(), 'i': base64.b64encode(ib).decode()}
        print(f'{r}: {len(P["tri"])} triangles, {len(P["data"])} corners, joint {[round(c, 1) for c in joints[r]]}')
    with open(os.path.join(OUT, 'monster.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))

    img = next(i for i in bpy.data.images if i.size[0] > 0)
    img.scale(TEXTURE, TEXTURE)
    img.filepath_raw = os.path.join(OUT, 'monster.png')
    img.file_format = 'PNG'
    img.save()
    print('size', [round(c, 1) for c in (hi - lo) * scale])


main()
