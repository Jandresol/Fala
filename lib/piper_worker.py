import base64
import io
import json
import sys
import wave

from piper import PiperVoice, SynthesisConfig


def synthesize_wav(voice, text, length_scale):
    config = SynthesisConfig(length_scale=length_scale)
    buffer = io.BytesIO()
    wav_params_set = False

    with wave.open(buffer, "wb") as wav_file:
        for chunk in voice.synthesize(text, config):
            if not wav_params_set:
                wav_file.setframerate(chunk.sample_rate)
                wav_file.setsampwidth(chunk.sample_width)
                wav_file.setnchannels(chunk.sample_channels)
                wav_params_set = True
            wav_file.writeframes(chunk.audio_int16_bytes)

    return buffer.getvalue()


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing Piper model path."}), flush=True)
        return 2

    voice = PiperVoice.load(sys.argv[1])
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        try:
            request = json.loads(line)
            audio = synthesize_wav(
                voice,
                request.get("text", ""),
                request.get("lengthScale"),
            )
            print(json.dumps({"audio": base64.b64encode(audio).decode("ascii")}), flush=True)
        except Exception as err:
            print(json.dumps({"error": str(err)}), flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
