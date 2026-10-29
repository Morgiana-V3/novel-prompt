import type { ModelFile } from './models'

// Pinned and verified ONNX conversions; weights are downloaded separately from the app.
export const MODEL_FILES: ModelFile[] = [
  {
    model: 'pixai',
    file: 'pixai.onnx',
    name: 'PixAI v1.0 角色识别（INT8）',
    bytes: 548285507,
    sha256: '71b78283846a3a5e6f9ad5a492f50bcf68013faee6e9e5ad8847c5cee4c79f8b',
    url: 'https://huggingface.co/Mexes/pixai-tagger-v1.0-onnx-fp32-fp16-int8/resolve/0800778563144a0e6fdf41ddadd84aae3cb0dbcf/model_int8.onnx',
    source:
      'https://huggingface.co/Mexes/pixai-tagger-v1.0-onnx-fp32-fp16-int8/tree/0800778563144a0e6fdf41ddadd84aae3cb0dbcf',
    license: 'Apache-2.0',
  },
  {
    model: 'pixai',
    file: 'pixai-tags.csv',
    name: 'PixAI 标签',
    bytes: 804671,
    sha256: 'a9455cbf0a910d4a3890739f2f70bd986278f4594285ef1049121a03896e2a6d',
    url: 'https://huggingface.co/Mexes/pixai-tagger-v1.0-onnx-fp32-fp16-int8/resolve/0800778563144a0e6fdf41ddadd84aae3cb0dbcf/selected_tags.csv',
    source:
      'https://huggingface.co/Mexes/pixai-tagger-v1.0-onnx-fp32-fp16-int8/tree/0800778563144a0e6fdf41ddadd84aae3cb0dbcf',
    license: 'Apache-2.0',
  },
  {
    model: 'k2',
    file: 'k2.onnx',
    name: 'Kaloscope 2',
    bytes: 294089002,
    sha256: 'afbf18c884e1a600f383b89452497c9bf1df8b90503b4e36b139368bf0509400',
    url: 'https://huggingface.co/Mooshie/kaloscope-web/resolve/79c383f3b4b3397398fc08bd5074fea2553cdec9/kaloscope2_web.onnx',
    source:
      'https://huggingface.co/Mooshie/kaloscope-web/tree/79c383f3b4b3397398fc08bd5074fea2553cdec9',
    license: 'Apache-2.0',
  },
  {
    model: 'k2',
    file: 'k2-labels.json',
    name: 'Kaloscope 2 标签',
    bytes: 564964,
    sha256: '223e9c7ea25462c6d8a02042fc9c622e8d78a0031beca06d93a78b117b804aab',
    url: 'https://huggingface.co/Mooshie/kaloscope-web/resolve/79c383f3b4b3397398fc08bd5074fea2553cdec9/labels_v2.json',
    source:
      'https://huggingface.co/Mooshie/kaloscope-web/tree/79c383f3b4b3397398fc08bd5074fea2553cdec9',
    license: 'Apache-2.0',
  },
  {
    model: 'k3',
    file: 'k3.onnx',
    name: 'Kaloscope 3',
    bytes: 169079820,
    sha256: '6085bde6d76d241e4ff288efd0d02e3e80d526228d3222d457d9997a79955c85',
    url: 'https://huggingface.co/Mooshie/kaloscope-web/resolve/79c383f3b4b3397398fc08bd5074fea2553cdec9/kaloscope3_v1_artist_web.onnx',
    source:
      'https://huggingface.co/Mooshie/kaloscope-web/tree/79c383f3b4b3397398fc08bd5074fea2553cdec9',
    license: 'DINOv3',
  },
  {
    model: 'k3',
    file: 'k3-labels.json',
    name: 'Kaloscope 3 标签',
    bytes: 634396,
    sha256: '197a6d5ea42d0f72a73d52079864891868e7c1d66ba80bc9b1f45cfcacd71635',
    url: 'https://huggingface.co/Mooshie/kaloscope-web/resolve/79c383f3b4b3397398fc08bd5074fea2553cdec9/labels_v3.json',
    source:
      'https://huggingface.co/Mooshie/kaloscope-web/tree/79c383f3b4b3397398fc08bd5074fea2553cdec9',
    license: 'DINOv3',
  },
  {
    model: 'k3',
    file: 'DINOv3-LICENSE.md',
    name: 'DINOv3 许可',
    bytes: 7503,
    sha256: '25d122eb8f5b880fd23c736fb6ea8018ee45c12237e00b8a86d14c653904999e',
    url: 'https://huggingface.co/Mooshie/kaloscope-web/resolve/79c383f3b4b3397398fc08bd5074fea2553cdec9/LICENSE.md',
    source:
      'https://huggingface.co/Mooshie/kaloscope-web/tree/79c383f3b4b3397398fc08bd5074fea2553cdec9',
    license: 'DINOv3',
  },
  {
    model: 'wd',
    file: 'wd.onnx',
    name: 'WD 内容识别',
    bytes: 1260435999,
    sha256: '9e768793060c7939b277ccb382783e8670e8a042d29d77aa736be0c8cc898bfc',
    url: 'https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3/resolve/b25b82a03f7282e41aa2f257a52c7583b710bd1c/model.onnx',
    source:
      'https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3/tree/b25b82a03f7282e41aa2f257a52c7583b710bd1c',
    license: 'Apache-2.0',
  },
  {
    model: 'wd',
    file: 'wd-tags.csv',
    name: 'WD 标签',
    bytes: 308468,
    sha256: '298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217',
    url: 'https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3/resolve/b25b82a03f7282e41aa2f257a52c7583b710bd1c/selected_tags.csv',
    source:
      'https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3/tree/b25b82a03f7282e41aa2f257a52c7583b710bd1c',
    license: 'Apache-2.0',
  },
]
