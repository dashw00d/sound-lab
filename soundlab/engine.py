"""Stable Audio 3 Medium, loaded once: text-to-audio and audio-to-audio.

The upstream library resolves "medium" to the gated stabilityai repo; this points it at the ungated mirror
(paths.MODEL_REPO), whose model_config.json loads T5Gemma from the mirror too. Generation runs offline once the
model is in the cache (install.py downloads it)."""
from __future__ import annotations

import os
import time

import numpy as np

from . import paths
from .dsp import SR


class Engine:
    def __init__(self):
        os.environ.setdefault("HF_HOME", str(paths.hf_home()))
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TQDM_DISABLE", "1")
        import torch
        from stable_audio_3 import StableAudioModel, model_configs

        medium = model_configs.ModelConfig(paths.MODEL_REPO, "model_config.json", "model.safetensors")
        model_configs.models["medium"] = medium
        model_configs.all_models["medium"] = medium
        self.torch = torch
        self.model = StableAudioModel.from_pretrained("medium")
        self.sample_size = self.model.model_config["sample_size"]
        assert self.model.model.sample_rate == SR, self.model.model.sample_rate
        self.last_s = 0.0

    def generate(self, prompt: str, seconds: float, seed: int, init: np.ndarray | None = None,
                 noise: float = 1.0) -> np.ndarray:
        """`seconds` of stereo audio, (samples, 2) float64. With `init` (audio at SR), audio-to-audio: `noise`
        sets how far it may move from it (0.5 keeps rhythm and chords; 0.7 rearranges)."""
        kw = {}
        if init is not None:
            kw = dict(init_audio=(SR, self.torch.from_numpy(init.T.astype(np.float32))), init_noise_level=noise)
        t0 = time.perf_counter()
        out = self.model.generate(prompt=prompt, duration=seconds, seed=seed, sample_size=self.sample_size, **kw)
        if self.torch.cuda.is_available():
            self.torch.cuda.synchronize()
        self.last_s = time.perf_counter() - t0
        x = out[0].float().cpu().numpy().T.astype(np.float64)
        return x / 32767.0 if not out.dtype.is_floating_point else x
