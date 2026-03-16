const BASE = '';

export interface Meeting {
  id: string;
  title: string;
  created_at: string;
  status: 'uploaded' | 'analyzed' | 'approved';
}

export interface AiOutput {
  meeting_metadata: {
    title: string;
    date_mentioned: string | null;
    participants: string[];
    duration_estimate: string | null;
  };
  decisions: Array<{
    id: string;
    description: string;
    decision_type: string;
    made_by: string;
    confidence: 'high' | 'medium' | 'low';
    confidence_rationale: string;
    source_quote: string;
  }>;
  action_items: Array<{
    id: string;
    task: string;
    owner: string;
    deadline: string | null;
    commitment_type: string;
    confidence: 'high' | 'medium' | 'low';
    confidence_rationale: string;
    source_quote: string;
    verified?: boolean;
  }>;
  open_risks: Array<{
    id: string;
    description: string;
    raised_by: string;
    severity: 'high' | 'medium' | 'low';
    source_quote: string;
  }>;
  state_of_direction: string;
  trust_flags: string[];
}

export const api = {
  async getProviders() {
    const res = await fetch(`${BASE}/api/providers`);
    return res.json() as Promise<{ providers: string[]; default: string | null }>;
  },

  async uploadTranscript(data: FormData) {
    const res = await fetch(`${BASE}/api/upload-transcript`, { method: 'POST', body: data });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async uploadAudio(data: FormData) {
    const res = await fetch(`${BASE}/api/upload-audio`, { method: 'POST', body: data });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async analyze(meetingId: string, provider?: string) {
    const res = await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting_id: meetingId, provider }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async approve(meetingId: string, verifiedOutput: AiOutput) {
    const res = await fetch(`${BASE}/api/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting_id: meetingId, verified_output: verifiedOutput }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async getMeetings() {
    const res = await fetch(`${BASE}/api/meetings`);
    return res.json() as Promise<Meeting[]>;
  },

  async getMeeting(id: string) {
    const res = await fetch(`${BASE}/api/meetings/${id}`);
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async queryMemory(question: string, provider?: string) {
    const res = await fetch(`${BASE}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, provider }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async getReadAhead(agenda: string, participants: string[], provider?: string) {
    const res = await fetch(`${BASE}/api/prep/read-ahead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agenda, participants, provider }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async getRecommendedParticipants(agenda: string) {
    const res = await fetch(`${BASE}/api/prep/recommend-participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agenda }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async getOpenItems(participant?: string) {
    const url = participant
      ? `${BASE}/api/prep/open-items?participant=${encodeURIComponent(participant)}`
      : `${BASE}/api/prep/open-items`;
    const res = await fetch(url);
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async updateActionItemStatus(itemId: string, status: 'completed' | 'cancelled') {
    const res = await fetch(`${BASE}/api/prep/action-items/${itemId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async startLiveSession(agenda: string, participants: string[]) {
    const res = await fetch(`${BASE}/api/live/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agenda, participants }),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async endLiveSession() {
    const res = await fetch(`${BASE}/api/live/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error((await res.json()).detail);
    return res.json();
  },

  async getLiveStatus() {
    const res = await fetch(`${BASE}/api/live/status`);
    return res.json();
  },
};
