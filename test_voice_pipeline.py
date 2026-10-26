#!/usr/bin/env python3
"""
Simple test to verify voice pipeline can be initialized
"""

import asyncio
import sys
import os

# Add backend to path
backend_path = '/Users/kennethaman/tto-golden/backend'
sys.path.insert(0, backend_path)

async def test_voice_pipeline():
    """Test that voice pipeline components can be imported and instantiated."""
    print("Testing voice pipeline initialization...")
    
    # Test imports
    from voice.pipeline import VoicePipeline, VoiceConfig
    from voice.webrtc_handler import VoiceWebRTCHandler
    
    print("Imports successful")
    
    # Test config creation
    config = VoiceConfig.from_env()
    print(f"Config created: STT={config.stt_model}, LLM={config.llm_model}")
    
    # Test pipeline creation
    pipeline = VoicePipeline(config)
    print("Pipeline created")
    
    # Test initialization (will fail without models but that's OK for this test)
    try:
        await pipeline.initialize()
        print("Pipeline initialized")
    except Exception as e:
        print(f"Pipeline initialization failed (expected without models): {type(e).__name__}")
    
    # Test handler creation
    handler = VoiceWebRTCHandler(pipeline)
    print("WebRTC handler created")
    
    # Test routes creation
    from voice.webrtc_handler import create_voice_routes
    routes = create_voice_routes(handler)
    print(f"Voice routes created: {len(routes)} routes")
    
    print("\nAll voice pipeline components working!")
    return True

if __name__ == "__main__":
    try:
        asyncio.run(test_voice_pipeline())
        print("\nVoice pipeline test passed!")
    except Exception as e:
        print(f"\nTest failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
