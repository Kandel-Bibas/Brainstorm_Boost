"""ChatSession: manages chat history and RAG-based answer generation."""
from __future__ import annotations

import logging

from database import (
    create_chat_session,
    get_chat_session,
    add_chat_message,
    get_chat_messages,
)
from llm_client import generate

logger = logging.getLogger(__name__)

CHAT_SYSTEM_PROMPT = """You are Brainstorm Boost, an AI assistant that helps teams understand their meeting history.
You answer questions by synthesizing information from past meeting records.
Always cite which meetings your answer is based on.
Be concise and actionable. If the information isn't in the meeting records, say so."""

MAX_HISTORY_MESSAGES = 10


class ChatSession:
    def __init__(self, session_id: str = None):
        if session_id is None:
            # Create a new session
            self.session_id = create_chat_session()
        else:
            # Load existing session — validate it exists
            session = get_chat_session(session_id)
            if session is None:
                raise ValueError(f"Chat session '{session_id}' not found")
            self.session_id = session_id

    def send_message(self, message: str, memory, context_meeting_id: str = None, provider: str = None) -> dict:
        """Process a user message and return the assistant's response."""
        # 1. Save user message to DB
        add_chat_message(self.session_id, "user", message, context_meeting_id=context_meeting_id)

        # 2. Build conversation history (last 10)
        history = self._build_conversation_history()

        # 3. RAG: dual retrieval (graph + vector)
        rag_context = self._build_rag_context(message, memory, context_meeting_id=context_meeting_id)

        # 4. Build prompt with history + RAG context
        prompt = self._build_prompt(message, history, rag_context)

        # 5. Call llm_client.generate() with system_prompt=CHAT_SYSTEM_PROMPT
        result = generate(prompt, provider=provider, system_prompt=CHAT_SYSTEM_PROMPT)

        # 6. Extract answer + sources from LLM response
        answer = result.get("answer", str(result))
        raw_sources = result.get("sources", [])

        # Sources can come from both graph context and transcript context
        transcript_chunks = rag_context.get("transcript_context", [])
        graph_context = rag_context.get("graph_context", "")
        all_titles = {item.get("meeting_title", "") for item in transcript_chunks if item.get("meeting_title")}
        # Also include any titles mentioned in graph context lines (best-effort)
        sources = [s for s in raw_sources if s] if raw_sources else list(all_titles)

        # 7. Save assistant message + sources to DB
        add_chat_message(
            self.session_id,
            "assistant",
            answer,
            sources=sources,
            context_meeting_id=context_meeting_id,
        )

        # 8. Return result
        return {
            "session_id": self.session_id,
            "response": answer,
            "sources": sources,
        }

    def _build_conversation_history(self) -> list[dict]:
        return get_chat_messages(self.session_id, limit=MAX_HISTORY_MESSAGES)

    def _build_rag_context(self, query_text: str, memory, context_meeting_id: str = None) -> dict:
        """Dual retrieval: graph traversal + vector search."""
        from knowledge_graph import KnowledgeGraph

        # Path 1: Graph query
        kg = KnowledgeGraph()
        graph_text = ""
        try:
            graph_results = kg.query(query_text, meeting_id=context_meeting_id)
            if graph_results["nodes"]:
                graph_text = kg.serialize_subgraph_for_prompt(graph_results)
        except Exception:
            logger.exception("Graph query failed")

        # Path 2: Vector search (existing ChromaDB)
        transcript_chunks = []
        try:
            if context_meeting_id:
                all_results = memory.query(query_text, top_k=6)
                scoped = [r for r in all_results if r.get("meeting_id") == context_meeting_id][:3]
                global_results = [r for r in all_results if r.get("meeting_id") != context_meeting_id][:3]
                transcript_chunks = scoped + global_results
            else:
                transcript_chunks = memory.query(query_text, top_k=5)
        except Exception:
            logger.exception("Vector search failed")

        return {
            "graph_context": graph_text,
            "transcript_context": transcript_chunks,
        }

    def _build_prompt(self, message: str, history: list[dict], rag_context: dict) -> str:
        """Build the full prompt including conversation history and dual RAG context."""
        parts: list[str] = []

        if history:
            history_lines = []
            for msg in history:
                role_label = "User" if msg["role"] == "user" else "Assistant"
                history_lines.append(f"{role_label}: {msg['content']}")
            parts.append("Previous conversation:\n" + "\n".join(history_lines) + "\n")

        graph_context = rag_context.get("graph_context", "") if isinstance(rag_context, dict) else ""
        transcript_chunks = rag_context.get("transcript_context", []) if isinstance(rag_context, dict) else []

        parts.append(f"Knowledge Graph:\n{graph_context}\n" if graph_context else "Knowledge Graph:\n(none)\n")

        if transcript_chunks:
            excerpt_lines = "\n".join(
                f"- [{item.get('meeting_title', 'Unknown')}] {item.get('content', '')}"
                for item in transcript_chunks
            )
            parts.append(f"Original Transcript Excerpts:\n{excerpt_lines}\n")
        else:
            parts.append("Original Transcript Excerpts:\n(none)\n")

        parts.append(f"Current question: {message}")
        parts.append(
            '\nReturn a JSON object:\n'
            '{"answer": "...", "sources": ["meeting title 1"]}\n'
            '\nIMPORTANT: Only use information from the provided knowledge graph and transcripts. '
            "If you don't have enough information, say so."
        )

        return "\n".join(parts)
