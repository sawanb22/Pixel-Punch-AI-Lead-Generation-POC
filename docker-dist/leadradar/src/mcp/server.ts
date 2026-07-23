import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDatabase } from "../db/database.js";
import {
  getPendingLeads,
  saveScoreAndDraft,
  recordFeedbackTool,
  getFeedbackStatsTool,
  getTopPicksTool,
} from "./tools.js";

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

async function main() {
  const dbPath = process.env.LEADRADAR_DB ?? "leadradar.db";
  console.error(`LeadRadar MCP starting with DB=${dbPath}`);
  const db = openDatabase(dbPath);

  const server = new McpServer({
    name: "leadradar",
    version: "0.1.0",
  });

  server.registerTool(
    "get_pending_leads",
    {
      description: "List gated (pending) leads for a project",
      inputSchema: {
        project_id: z.number().int().positive(),
      },
    },
    async (args) => {
      try {
        return textResult(getPendingLeads(db, args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "save_score_and_draft",
    {
      description: "Save a score (and optional draft) for a lead",
      inputSchema: {
        project_id: z.number().int().positive(),
        lead_id: z.number().int().positive(),
        score: z.number().min(0).max(100),
        reasons: z.string(),
        draft: z.string().nullable().optional(),
      },
    },
    async (args) => {
      try {
        return textResult(saveScoreAndDraft(db, args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "record_feedback",
    {
      description: "Record good/bad feedback for a lead",
      inputSchema: {
        project_id: z.number().int().positive(),
        lead_id: z.number().int().positive(),
        good: z.boolean(),
        notes: z.string().nullable().optional(),
        reviewed_by: z.string().nullable().optional(),
        source: z.enum(["dashboard", "telegram"]).optional(),
      },
    },
    async (args) => {
      try {
        return textResult(recordFeedbackTool(db, args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_feedback_stats",
    {
      description: "Get feedback approval stats for a project",
      inputSchema: {
        project_id: z.number().int().positive(),
      },
    },
    async (args) => {
      try {
        return textResult(getFeedbackStatsTool(db, args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    "get_top_picks",
    {
      description:
        "Get top scored leads awaiting feedback, with Hermes clarify message payloads (Good/Bad)",
      inputSchema: {
        project_id: z.number().int().positive(),
        limit: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      try {
        return textResult(getTopPicksTool(db, args));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LeadRadar MCP server connected on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
