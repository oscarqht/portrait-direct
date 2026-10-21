#!/usr/bin/env python3
"""A tiny self-contained GLB fixture for loader integration tests."""
import json, pathlib, struct
vertices = struct.pack('<9f', -.6,-.6,0, .6,-.6,0, 0,.6,0)
document = {
    'asset': {'version':'2.0'}, 'scene': 0, 'scenes': [{'nodes':[0]}],
    'nodes': [{'mesh':0}], 'meshes': [{'primitives':[{'attributes':{'POSITION':0},'material':0}]}],
    'materials':[{'pbrMetallicRoughness':{'baseColorFactor':[0.3,0.9,0.65,1],'metallicFactor':0,'roughnessFactor':0.8},'doubleSided':True}],
    'buffers': [{'byteLength':len(vertices)}], 'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(vertices)}],
    'accessors':[{'bufferView':0,'componentType':5126,'count':3,'type':'VEC3','min':[-.6,-.6,0],'max':[.6,.6,0]}],
}
data = json.dumps(document,separators=(',',':')).encode()
data += b' '*((-len(data))%4)
glb = struct.pack('<III',0x46546C67,2,12+8+len(data)+8+len(vertices))+struct.pack('<II',len(data),0x4E4F534A)+data+struct.pack('<II',len(vertices),0x004E4942)+vertices
target=pathlib.Path('artifacts/triangle.glb');target.parent.mkdir(exist_ok=True);target.write_bytes(glb)
print(target.resolve())
