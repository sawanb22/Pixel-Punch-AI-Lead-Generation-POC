export interface FeedbackDoc {
  projectId: number;
  leadId: number;
  company: string;
  website: string | null;
  email: string | null;
  score: number | null;
  good: boolean;
  notes: string | null;
  text: string;
}
