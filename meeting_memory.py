from __future__ import annotations

from pathlib import Path

import chromadb

from embeddings import get_embedding_model


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

    def index_meeting(self, meeting_id: str, ai_output: dict) -> None:
        """Index a meeting's AI output into ChromaDB for semantic search."""
        model = get_embedding_model()
        documents = []
        metadatas = []
        ids = []

        title = ai_output.get("meeting_metadata", {}).get("title", "Untitled")

        # Index decisions
        for i, d in enumerate(ai_output.get("decisions", [])):
            item_id = d.get("id") or f"D{i+1}"
            doc = f"Decision: {d['description']}"
            if d.get("source_quote"):
                doc += f' (Source: "{d["source_quote"]}")'
            documents.append(doc)
            metadatas.append({
                "meeting_id": meeting_id,
                "meeting_title": title,
                "item_type": "decision",
                "item_id": item_id,
            })
            ids.append(f"{meeting_id}_{item_id}")

        # Index action items
        for i, a in enumerate(ai_output.get("action_items", [])):
            item_id = a.get("id") or f"A{i+1}"
            doc = f"Action item: {a['task']}"
            if a.get("owner"):
                doc += f" (Owner: {a['owner']})"
            if a.get("deadline"):
                doc += f" (Deadline: {a['deadline']})"
            if a.get("source_quote"):
                doc += f' (Source: "{a["source_quote"]}")'
            documents.append(doc)
            metadatas.append({
                "meeting_id": meeting_id,
                "meeting_title": title,
                "item_type": "action_item",
                "item_id": item_id,
            })
            ids.append(f"{meeting_id}_{item_id}")

        # Index risks
        for i, r in enumerate(ai_output.get("open_risks", [])):
            item_id = r.get("id") or f"R{i+1}"
            doc = f"Risk: {r['description']}"
            if r.get("source_quote"):
                doc += f' (Source: "{r["source_quote"]}")'
            documents.append(doc)
            metadatas.append({
                "meeting_id": meeting_id,
                "meeting_title": title,
                "item_type": "risk",
                "item_id": item_id,
            })
            ids.append(f"{meeting_id}_{item_id}")

        # Index state of direction
        sod = ai_output.get("state_of_direction")
        if sod:
            documents.append(f"State of direction: {sod}")
            metadatas.append({
                "meeting_id": meeting_id,
                "meeting_title": title,
                "item_type": "direction",
                "item_id": "SOD",
            })
            ids.append(f"{meeting_id}_SOD")

        if not documents:
            return

        embeddings = model.encode(documents).tolist()
        self._collection.upsert(
            ids=ids,
            documents=documents,
            embeddings=embeddings,
            metadatas=metadatas,
        )

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

        context_items = self.query(question, top_k=5)
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

Only use information from the provided excerpts. If the excerpts don't contain enough information, say so."""

        result = generate(prompt, provider=provider)
        result["context"] = context_items
        return result
