import os
import tempfile
import whisper
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
import uvicorn
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load the local whisper model
print("Loading Whisper model...")
model = whisper.load_model("base")
print("Whisper model loaded.")

class TranscriptionResult(BaseModel):
    transcript: str
    summary: str
    actions: list[str]

# Setup OpenAI Client for summarization
# Depending on setup, pick up API key from env
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))

def summarize_with_llm(transcription_text: str):
    """
    Summarize and find action points using LLM
    """
    if not client.api_key:
        return {
            "summary": "Mock Summary since no OpenAI key is set.",
            "actions": ["Mock Action 1", "Mock Action 2"]
        }
        
    prompt = f"""
    You are an AI meeting assistant. Below is a transcript from a meeting/conversation.
    Please provide:
    1. A short summary of what was discussed.
    2. A list of actionable items (action points).
    
    Format your response exactly like this:
    SUMMARY:
    <summary here>
    
    ACTIONS:
    - <action 1>
    - <action 2>
    
    TRANSCRIPT:
    {transcription_text}
    """
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": "You are a helpful assistant."},
                      {"role": "user", "content": prompt}]
        )
        content = response.choices[0].message.content
        
        summary_part = content.split("ACTIONS:")[0].replace("SUMMARY:", "").strip()
        actions_part = content.split("ACTIONS:")[1].strip()
        actions = [a.replace("-", "").strip() for a in actions_part.split("\n") if a.strip()]
        
        return {
            "summary": summary_part,
            "actions": actions
        }
    except Exception as e:
        print(f"Error during summarization: {e}")
        return {
            "summary": "Failed to summarize text.",
            "actions": []
        }

@app.post("/api/transcribe", response_model=TranscriptionResult)
async def process_audio(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded")
        
    try:
        # Save temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
            tmp.write(await file.read())
            temp_path = tmp.name

        # Transcribe with Whisper
        result = model.transcribe(temp_path)
        transcript_text = result["text"]

        # Cleanup
        os.unlink(temp_path)

        # Summarize
        summary_data = summarize_with_llm(transcript_text)

        return TranscriptionResult(
            transcript=transcript_text,
            summary=summary_data["summary"],
            actions=summary_data["actions"]
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
