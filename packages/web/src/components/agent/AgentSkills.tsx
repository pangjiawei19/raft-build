import { Badge, Button, Card, InlineCode } from "@botiverse/raft-ui";
import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, ChevronRight, Globe, FolderOpen, RefreshCw } from "lucide-react";
import { useIntl } from "react-intl";
import apiClient from "../../api/client";
import type { SkillInfo } from "@botiverse/raft-shared";
import SectionHeader from "../ui/SectionHeader";

interface SkillsData {
  global: SkillInfo[];
  workspace: SkillInfo[];
}

const EMPTY_SKILLS: SkillInfo[] = [];

/**
 * One line per skill (name, `/command` badge, truncated description); clicking
 * expands the full description. Agents commonly carry dozens of skills, and the
 * old one-card-per-skill layout ran to several screens (xxchan, 2026-10-15).
 */
function SkillRow({ skill }: { skill: SkillInfo }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="block w-full px-3 py-2 text-left hover:bg-fill-pressed"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Chevron size={14} className="shrink-0 text-foreground-hint" />
          <span className="shrink-0 text-callout font-semibold text-foreground">{skill.displayName}</span>
          {skill.userInvocable && (
            <Badge appearance="outline" className="shrink-0">
              /{skill.name}
            </Badge>
          )}
          {!open && skill.description && (
            <span className="truncate text-caption text-foreground-muted">{skill.description}</span>
          )}
        </span>
        {open && skill.description && (
          <span className="mt-1 block pl-[22px] text-caption text-foreground-muted">{skill.description}</span>
        )}
      </button>
    </li>
  );
}

function groupByPath(skills: SkillInfo[]): Map<string, SkillInfo[]> {
  const groups = new Map<string, SkillInfo[]>();
  for (const skill of skills) {
    const key = skill.sourcePath || "unknown";
    const list = groups.get(key) || [];
    list.push(skill);
    groups.set(key, list);
  }
  return groups;
}

function PathGroup({ path, skills }: { path: string; skills: SkillInfo[] }) {
  return (
    <div>
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <InlineCode className="min-w-0 text-mono-meta text-foreground-hint">{path}</InlineCode>
        <span className="shrink-0 font-mono text-mono-meta text-foreground-hint">({skills.length})</span>
      </div>
      {/* Fixed-height box that scrolls on its own, so a long list does not
          stretch the profile page (about ten rows visible). */}
      <Card
        render={<ul />}
        data-testid="agent-skills-list"
        className="max-h-80 overflow-y-auto divide-y divide-line-hairline"
      >
        {skills.map((skill) => (
          <SkillRow key={skill.name} skill={skill} />
        ))}
      </Card>
    </div>
  );
}

function SkillSubSection({ label, icon: Icon, skills, emptyText }: {
  label: string;
  icon: typeof Globe;
  skills: SkillInfo[];
  emptyText: string;
}) {
  const groups = groupByPath(skills);

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <Icon size={14} className="shrink-0 text-foreground-muted" />
        <span className="text-footnote font-semibold text-foreground-muted">
          {label}
        </span>
        <span className="font-mono text-mono-meta text-foreground-hint">({skills.length})</span>
      </div>
      {skills.length > 0 ? (
        <div className="space-y-4">
          {[...groups.entries()].map(([path, pathSkills]) => (
            <PathGroup key={path} path={path} skills={pathSkills} />
          ))}
        </div>
      ) : (
        <p className="text-caption text-foreground-hint">{emptyText}</p>
      )}
    </div>
  );
}

export default function AgentSkills({ agentId, embedded }: { agentId: string; embedded?: boolean }) {
  const { formatMessage } = useIntl();
  const formatMessageRef = useRef(formatMessage);
  formatMessageRef.current = formatMessage;
  const [data, setData] = useState<SkillsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<SkillsData>(`/agents/${agentId}/skills`);
      setData(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || formatMessageRef.current({ id: "agent.skills.loadFailed" }));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  // Async-loader pattern: `loading` is a transient async-fetch indicator, not
  // prop-derived state. Same FP family as AgentDetailPanel L228.
  useEffect(() => {
    // oxlint-disable-next-line react-doctor/no-derived-state
    fetchSkills();
  }, [fetchSkills]);

  if (loading) {
    return (
      <div className={embedded ? "px-5 py-4" : "flex flex-1 items-center justify-center bg-layer-canvas"}>
        <span className="text-callout text-foreground-hint">{formatMessage({ id: "agent.skills.loading" })}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={embedded ? "px-5 py-4 flex flex-col items-center gap-3" : "flex flex-1 flex-col items-center justify-center gap-3 bg-layer-canvas"}>
        <span className="text-footnote font-semibold text-warning-strong">{error}</span>
        <Button variant="outline" size="sm" onClick={fetchSkills}>
          <RefreshCw size={16} />
          {formatMessage({ id: "agent.skills.retry" })}
        </Button>
      </div>
    );
  }

  const totalSkills = (data?.global?.length || 0) + (data?.workspace?.length || 0);

  return (
    <div className={embedded ? "" : "flex-1 overflow-y-auto bg-layer-canvas"}>
      <div className="px-5 py-4">
        {/* Same header + count format as the other profile sections; when there
            are no skills at all, the header's 0 is the whole section. */}
        <SectionHeader
          className={totalSkills > 0 ? "mb-3" : undefined}
          label={formatMessage({ id: "agent.skills.heading" })}
          count={totalSkills}
        />
        {totalSkills > 0 && (
        <div className="space-y-4">
          <SkillSubSection
            label={formatMessage({ id: "agent.skills.global" })}
            icon={Globe}
            skills={data?.global || EMPTY_SKILLS}
            emptyText={formatMessage({ id: "agent.skills.globalEmpty" })}
          />
          <SkillSubSection
            label={formatMessage({ id: "agent.skills.workspace" })}
            icon={FolderOpen}
            skills={data?.workspace || EMPTY_SKILLS}
            emptyText={formatMessage({ id: "agent.skills.workspaceEmpty" })}
          />
        </div>
        )}
      </div>
    </div>
  );
}
