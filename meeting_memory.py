from __future__ import annotations

import logging
from pathlib import Path

import chromadb

from embeddings import get_embedding_model

logger = logging.getLogger(__name__)


class MeetingMemory:
    """ChromaDB-backed meeting knowledge base with semantic search."""

    def __init__(self, persist_dir: str = None):
        if persist_dir is None:
            persist_dir = str(Path(__file__).parent / "chroma_db")
        self._client = chromadb.PersistentClient(path=persist_dir)
        self._collection = self._client.get_or_create_collection(
            name="meeting_knowledge",
            metadata={"hnsw:space": "cosine"},
        )

    def index_meeting(self, meeting_id: str, ai_output: dict,
                      raw_transcript: str = None) -> None:
        """Index a meeting into ChromaDB with multiple chunk types.

        Creates separate embeddings for:
        1. Meeting overview (title, participants, summary)
        2. Each decision (natural language, not prefixed metadata soup)
        3. Each action item
        4. Each risk
        5. Transcript chunks (if raw_transcript provided)
        """
        # Remove any existing items for this meeting first (prevents duplicates)
        self.remove_meeting(meeting_id)

        model = get_embedding_model()
        documents = []
        metadatas = []
        ids = []

        meta = ai_output.get("meeting_metadata", {})
        title = meta.get("title", "Untitled")
        participants = meta.get("participants", [])
        date = meta.get("date_mentioned", "")

        # --- Chunk 1: Meeting overview ---
        overview_parts = [f"Meeting: {title}"]
        if participants:
            overview_parts.append(f"Participants: {', '.join(participants)}")
        if date:
            overview_parts.append(f"Date: {date}")
        sod = ai_output.get("state_of_direction", "")
        if sod:
            overview_parts.append(f"Summary: {sod}")

        documents.append("\n".join(overview_parts))
        metadatas.append({
            "meeting_id": meeting_id,
            "meeting_title": title,
            "item_type": "overview",
            "item_id": "overview",
            "participants": ", ".join(participants),
        })
        ids.append(f"{meeting_id}_overview")

        # --- Chunk 2: Each decision as natural language ---
        for i, d in enumerate(ai_output.get("decisions", [])):
            item_id = d.get("id") or f"D{i+1}"

            # Embed the natural language content — what a human would say about this decision
            text = d.get("description", "")
            if d.get("made_by"):
                text += f". Decided by {d['made_by']}"
            if d.get("source_quote"):
                text += f'. Original quote: "{d["source_quote"]}"'

            documents.append(text)
            metadatas.append({
                "meeting_id": meeting_id,
                "meeting_title": title,
                "item_type": "decision",
                "item_id": item_id,
                "made_by": d.get("made_by", ""),
                "confidence": d.get("confidence", ""),
            })
            ids.append(f"{meeting_id}_{item_id}")

        # --- Chunk 3: Each action item ---
        for i, a in enumerate(ai_output.get("action_items", [])):
            item_id = a.get("id") or f"A{i+1}"

            text = a.get("task", "")
            if a.get("owner"):
                text += f". Assigned to {a['owner']}"
            if a.get("deadline"):
                text += f", due by {a['deadline']}"
            if a.get("source_quote"):
                text += f'. Original quote: "{a["source_quote"]}"'

            documents.append(text)
            metadatas.append({
                "meeting_id": meeting_id,
                "meeting_title": title,
                "item_type": "action_item",
                "item_id": item_id,
                "owner": a.get("owner", ""),
                "deadline": a.get("deadline", ""),
                "confidence": a.get("confidence", ""),
            })
            ids.append(f"{meeting_id}_{item_id}")

        # --- Chunk 4: Each risk ---
        for i, r in enumerate(ai_output.get("open_risks", [])):
            item_id = r.get("id") or f"R{i+1}"

            text = r.get("description", "")
            if r.get("raised_by"):
                text += f". Raised by {r['raised_by']}"
            if r.get("source_quote"):
                text += f'. Original quote: "{r["source_quote"]}"'

            documents.append(text)
            metadatas.append({
                "meeting_id": meeting_id,
                "meeting_title": title,
                "item_type": "risk",
                "item_id": item_id,
                "raised_by": r.get("raised_by", ""),
                "severity": r.get("severity", ""),
            })
            ids.append(f"{meeting_id}_{item_id}")

        # --- Chunk 5: Transcript chunks (overlapping windows) ---
        if raw_transcript and len(raw_transcript.strip()) > 100:
            chunks = _chunk_transcript(raw_transcript, chunk_size=500, overlap=100)
            for i, chunk in enumerate(chunks):
                documents.append(chunk)
                metadatas.append({
                    "meeting_id": meeting_id,
                    "meeting_title": title,
                    "item_type": "transcript",
                    "item_id": f"T{i+1}",
                })
                ids.append(f"{meeting_id}_T{i+1}")

        if not documents:
            return

        embeddings = model.encode(documents).tolist()
        self._collection.upsert(
            ids=ids,
            documents=documents,
            embeddings=embeddings,
            metadatas=metadatas,
        )
        logger.info(f"Indexed meeting {meeting_id} ({title}): {len(documents)} chunks")

    def is_meeting_indexed(self, meeting_id: str) -> bool:
        """Check if a meeting has any items in ChromaDB."""
        if self._collection.count() == 0:
            return False
        try:
            results = self._collection.get(
                where={"meeting_id": meeting_id},
                limit=1,
            )
            return len(results["ids"]) > 0
        except Exception:
            return False

    def remove_meeting(self, meeting_id: str) -> int:
        """Remove all indexed items for a meeting from ChromaDB. Returns count removed."""
        if self._collection.count() == 0:
            return 0
        try:
            results = self._collection.get(
                where={"meeting_id": meeting_id},
            )
            ids_to_delete = results["ids"]
            if ids_to_delete:
                self._collection.delete(ids=ids_to_delete)
            return len(ids_to_delete)
        except Exception:
            return 0

    def query(self, question: str, top_k: int = 5) -> list[dict]:
        """Semantic search across all indexed meetings."""
        if self._collection.count() == 0:
            return []

        model = get_embedding_model()
        query_embedding = model.encode([question]).tolist()

        results = self._collection.query(
            query_embeddings=query_embedding,
            n_results=min(top_k, self._collection.count()),
        )

        items = []
        for i in range(len(results["ids"][0])):
            items.append({
                "content": results["documents"][0][i],
                "meeting_id": results["metadatas"][0][i]["meeting_id"],
                "meeting_title": results["metadatas"][0][i]["meeting_title"],
                "item_type": results["metadatas"][0][i]["item_type"],
                "distance": results["distances"][0][i] if results.get("distances") else None,
            })
        return items

    def query_with_llm(self, question: str, provider: str = None) -> dict:
        """RAG: retrieve relevant context, then synthesize an answer with the LLM."""
        from llm_client import generate

        context_items = self.query(question, top_k=8)
        if not context_items:
            return {"answer": "No meeting data found. Upload and approve meetings first.", "sources": []}

        context_text = "\n".join(
            f"- [{item['meeting_title']}] {item['content']}" for item in context_items
        )

        prompt = f"""Based on the following meeting knowledge base excerpts, answer this question:

Question: {question}

Meeting Knowledge Base:
{context_text}

Return a JSON object with this exact format:
{{"answer": "your synthesized answer citing specific meetings", "sources": ["meeting title 1", "meeting title 2"]}}

IMPORTANT:
- Only use information from the provided excerpts. Never invent or hallucinate information.
- If the excerpts don't contain enough information to answer, say "I don't have enough information about that in the meeting records."
- Cite specific meetings by title when referencing information."""

        result = generate(prompt, provider=provider)
        result["context"] = context_items
        return result


def _chunk_transcript(text: str, chunk_size: int = 500, overlap: int = 100) -> list[str]:
    """Split transcript into overlapping chunks by word count."""
    words = text.split()
    if len(words) <= chunk_size:
        return [text]

    chunks = []
    start = 0
    while start < len(words):
        end = start + chunk_size
        chunk = " ".join(words[start:end])
        if chunk.strip():
            chunks.append(chunk)
        start += chunk_size - overlap

    return chunks
