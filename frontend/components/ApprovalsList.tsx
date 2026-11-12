"use client";

import { FileImage, FileText, Folder, Video } from "lucide-react";
import { useEffect } from "react";
import { useAssistantStore } from "../store/assistantStore";
import { ApiStatus } from "./ApiStatus";
import type { Approval } from "../lib/schemas";

const ICONS: Record<Approval["type"], typeof Folder> = { Folder, Video, PDF: FileText, Image: FileImage };

export function ApprovalsList() {
  const { approvals, approvalsError, loadApprovals } = useAssistantStore();

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  return (
    <main className="page">
      <h1>Approvals</h1>
      <p className="muted">Items waiting for your review.</p>
      <ApiStatus />
      {approvalsError && (
        <p className="error" role="alert">
          {approvalsError}
        </p>
      )}
      <ul className="approval-list">
        {approvals.map((a) => {
          const Icon = ICONS[a.type];
          return (
            <li key={a.id}>
              <span className="type-icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <span className="approval-main">
                <strong>{a.title}</strong>
                <small>
                  {a.type} · Submitted by {a.submittedBy}
                </small>
              </span>
              <span className="status">
                {a.status} - {a.statusDate}
              </span>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
