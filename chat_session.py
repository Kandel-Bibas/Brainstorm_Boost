"""ChatSession: manages chat history and RAG-based answer generation."""
from __future__ import annotations

from database import (
    create_chat_session,
    get_chat_session,
    add_chat_message,
    get_chat_messages,
)
from llm_client import generate

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

        # 3. RAG: query ChromaDB
        context_items = self._build_rag_context(message, memory, context_meeting_id=context_meeting_id)

        # 4. Build prompt with history + RAG context
        prompt = self._build_prompt(message, history, context_items)

        # 5. Call llm_client.generate() with system_prompt=CHAT_SYSTEM_PROMPT
        result = generate(prompt, provider=provider, system_prompt=CHAT_SYSTEM_PROMPT)

        # 6. Extract answer + sources from LLM response
        answer = result.get("answer", str(result))
        sources = result.get("sources", [])

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

    def _build_rag_context(self, query: str, memory, context_meeting_id: str = None) -> list[dict]:
        """Retrieve relevant context from ChromaDB.

        Two-query strategy when context_meeting_id is set:
        - Query 1: larger global query then filter by meeting_id for scoped results (up to 3)
        - Query 2: global query for 3 additional results
        Without context_meeting_id: single global query for 5 results.
        """
        if context_meeting_id is None:
            return memory.query(query, top_k=5)

        # Scoped query: fetch more results and filter by the target meeting
        all_results = memory.query(query, top_k=10)
        scoped = [r for r in all_results if r.get("meeting_id") == context_meeting_id][:3]

        # Global query for additional context
        global_results = memory.query(query, top_k=3)

        # Combine, deduplicate by content
        seen_contents: set[str] = set()
        combined: list[dict] = []
        for item in scoped + global_results:
            content = item.get("content", "")
            if content not in seen_contents:
                seen_contents.add(content)
                combined.append(item)

        return combined

    def _build_prompt(self, message: str, history: list[dict], context_items: list[dict]) -> str:
        """Build the full prompt including conversation history and RAG context."""
        parts: list[str] = []

        if context_items:
            context_text = "\n".join(
                f"- [{item['meeting_title']}] {item['content']}" for item in context_items
            )
            parts.append(f"Meeting Knowledge Base:\n{context_text}\n")

        if history:
            history_lines = []
            for msg in history:
                role_label = "User" if msg["role"] == "user" else "Assistant"
                history_lines.append(f"{role_label}: {msg['content']}")
            parts.append("Conversation history:\n" + "\n".join(history_lines) + "\n")

        parts.append(f"User: {message}")
        parts.append(
            '\nReturn a JSON object with this exact format:\n'
            '{"answer": "your synthesized answer citing specific meetings", "sources": ["meeting title 1", "meeting title 2"]}\n'
            'Only use information from the provided meeting excerpts. If the excerpts don\'t contain enough information, say so.'
        )

        return "\n".join(parts)
