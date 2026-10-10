#!/usr/bin/env python3
"""Voice Pipeline Benchmark Tool.

Measures latency for STT, LLM, TTS, and full pipeline.
Run with: python -m voice.benchmark
"""
import asyncio
import time
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from voice.pipeline import VoicePipeline, VoiceConfig


async def benchmark_stt(pipeline: VoicePipeline) -> dict:
    """Benchmark STT component."""
    print("=== STT Benchmark ===")
    # Ensure STT model is loaded
    if not pipeline._stt_model:
        await pipeline.initialize()

    # Create dummy audio (1 second of silence at 16kHz)
    import numpy as np
    audio = np.zeros(16000, dtype=np.int16).astype(np.float32) / 32768.0

    latencies = []
    for _ in range(5):
        start = time.time()
        try:
            segments, info = pipeline._stt_model.transcribe(
                audio,
                language=pipeline.config.stt_language,
                vad_filter=pipeline.config.stt_vad,
                beam_size=pipeline.config.stt_beam_size,
                best_of=pipeline.config.stt_best_of
            )
            text = " ".join(seg.text for seg in segments).strip()
            elapsed = time.time() - start
            latencies.append(elapsed)
            print(f"  Transcription: '{text[:50]}...' -> {elapsed:.2f}s")
        except Exception as e:
            print(f"  Error: {e}")
            latencies.append(float("inf"))

    valid_latencies = [l for l in latencies if l != float("inf")]
    avg_latency = sum(valid_latencies) / len(valid_latencies) if valid_latencies else 0
    print(f"  Average latency: {avg_latency:.2f}s")
    return {
        "test": "stt",
        "latencies": latencies,
        "average_latency": avg_latency,
        "success_rate": len(valid_latencies) / len(latencies) if latencies else 0
    }



async def benchmark_llm(pipeline: VoicePipeline) -> dict:
    """Benchmark LLM component."""
    print("=== LLM Benchmark ===")

    test_prompts = [
        "Run tests",
        "What is the error",
        "Show me the git status",
        "List files in current directory",
    ]

    latencies = []
    for prompt in test_prompts:
        start = time.time()
        try:
            response = await pipeline.generate_response(prompt)
            elapsed = time.time() - start
            latencies.append(elapsed)
            print(f"  Prompt: {prompt[:30]}... -> {elapsed:.2f}s")
            print(f"    Response: {response[:50]}...")
        except Exception as e:
            print(f"  Error: {e}")
            latencies.append(float("inf"))

    valid_latencies = [l for l in latencies if l != float("inf")]
    avg_latency = sum(valid_latencies) / len(valid_latencies) if valid_latencies else 0
    print(f"  Average latency: {avg_latency:.2f}s")
    return {
        "test": "llm",
        "latencies": latencies,
        "average_latency": avg_latency,
        "success_rate": len(valid_latencies) / len(latencies) if latencies else 0
    }


async def benchmark_tts(pipeline: VoicePipeline) -> dict:
    """Benchmark TTS component."""
    print("=== TTS Benchmark ===")
    # Ensure TTS model is loaded
    if not pipeline._tts_model:
        await pipeline.initialize()

    test_text = "This is a test of the text to speech system."

    latencies = []
    for _ in range(5):
        start = time.time()
        try:
            chunk_count = 0
            total_bytes = 0
            async for chunk in pipeline.synthesize(test_text):
                chunk_count += 1
                total_bytes += len(chunk)
            elapsed = time.time() - start
            latencies.append(elapsed)
            print(f"  TTS Result: {chunk_count} chunks, {total_bytes} bytes -> {elapsed:.2f}s")
        except Exception as e:
            print(f"  Error: {e}")
            latencies.append(float("inf"))

    valid_latencies = [l for l in latencies if l != float("inf")]
    avg_latency = sum(valid_latencies) / len(valid_latencies) if valid_latencies else 0
    print(f"  Average latency: {avg_latency:.2f}s")
    return {
        "test": "tts",
        "latencies": latencies,
        "average_latency": avg_latency,
        "success_rate": len(valid_latencies) / len(latencies) if latencies else 0
    }


async def benchmark_full_pipeline(pipeline: VoicePipeline) -> dict:
    """Run full pipeline benchmark."""
    print("=== Full Pipeline Benchmark ===")

    test_prompts = [
        "Run tests",
        "What is the error",
        "Show me the git status",
        "List files in current directory",
    ]

    latencies = []
    for prompt in test_prompts:
        start = time.time()
        try:
            # process_text_turn returns an async generator of audio chunks
            chunk_count = 0
            total_bytes = 0
            first_chunk_time = None
            async for chunk in pipeline.process_text_turn(prompt):
                if first_chunk_time is None:
                    first_chunk_time = time.time()
                chunk_count += 1
                total_bytes += len(chunk)
            
            # If we got chunks, use time to first chunk
            if first_chunk_time is not None:
                elapsed = first_chunk_time - start
                latencies.append(elapsed)
                print(f"  Prompt: {prompt[:30]}... -> {elapsed:.2f}s (first chunk)")
                print(f"    Generated: {chunk_count} chunks, {total_bytes} bytes")
            else:
                # No audio generated (likely LLM failed)
                elapsed = time.time() - start
                latencies.append(elapsed)
                print(f"  Prompt: {prompt[:30]}... -> {elapsed:.2f}s (no audio)")
        except Exception as e:
            print(f"  Error: {e}")
            latencies.append(float("inf"))

    valid_latencies = [l for l in latencies if l != float("inf")]
    avg_latency = sum(valid_latencies) / len(valid_latencies) if valid_latencies else 0
    print(f"  Average latency (first chunk): {avg_latency:.2f}s")
    return {
        "test": "full_pipeline",
        "latencies": latencies,
        "average_latency": avg_latency,
        "success_rate": len(valid_latencies) / len(latencies) if latencies else 0
    }


class VoiceBenchmarker:
    """Comprehensive voice pipeline benchmarking."""
    
    def __init__(self):
        self.config = VoiceConfig.from_env()
        self.pipeline = None
        self.results = []
    
    async def setup(self):
        """Initialize pipeline."""
        print("Initializing voice pipeline for benchmarking...")
        self.pipeline = VoicePipeline(self.config)
        await self.pipeline.initialize()
        print("Pipeline initialized")
    
    async def run_all(self) -> list:
        """Run all benchmarks."""
        if not self.pipeline:
            await self.setup()
        
        print("\n" + "="*50)
        print("VOICE PIPELINE BENCHMARK")
        print("="*50)
        
        # Run individual component benchmarks
        self.results.append(await benchmark_stt(self.pipeline))
        print()
        self.results.append(await benchmark_llm(self.pipeline))
        print()
        self.results.append(await benchmark_tts(self.pipeline))
        print()
        self.results.append(await benchmark_full_pipeline(self.pipeline))
        
        # Summary
        print("\n" + "="*50)
        print("BENCHMARK SUMMARY")
        print("="*50)
        for r in self.results:
            status = "OK" if r["success_rate"] > 0 else "FAILED"
            print(f"  {r['test']:20} | Avg: {r['average_latency']:.2f}s | Success: {r['success_rate']*100:.0f}% | {status}")
        
        return self.results
    
    async def cleanup(self):
        """Cleanup resources."""
        if self.pipeline:
            await self.pipeline.shutdown()


async def main():
    benchmarker = VoiceBenchmarker()
    try:
        await benchmarker.run_all()
    finally:
        await benchmarker.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
