import { Button } from "@botiverse/raft-ui";
import { useCallback, useState } from "react";
import { useIntl } from "react-intl";
import { Plus } from "lucide-react";
import { useTaskStore } from "../../store/taskStore";
import DialogCard from "../ui/DialogCard";
import Banner from "../ui/Banner";
import { TaskTitleRow } from "./TaskTitleRow";

export default function CreateTaskDialog({
  channelId,
  onClose,
}: {
  channelId: string;
  onClose: () => void;
}) {
  const { formatMessage } = useIntl();
  const [titles, setTitles] = useState<string[]>([""]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const createTasks = useTaskStore((s) => s.createTasks);

  const isBatch = titles.length > 1;

  const updateTitle = useCallback((index: number, value: string) => {
    setTitles((prev) => prev.map((t, i) => (i === index ? value : t)));
  }, []);

  const addRow = useCallback(() => {
    setTitles((prev) => [...prev, ""]);
  }, []);

  const removeRow = useCallback((index: number) => {
    setTitles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const nonEmpty = titles.map((t) => t.trim()).filter(Boolean);
    if (nonEmpty.length === 0) {
      setError(formatMessage({ id: "task.create.titleRequired" }));
      return;
    }

    setSubmitting(true);
    try {
      await createTasks(channelId, nonEmpty);
      onClose();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr.response?.data?.error || formatMessage({ id: "task.create.failed" }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogCard title={formatMessage({ id: "task.create.heading" }, { count: isBatch ? 2 : 1 })} onClose={onClose}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Banner intent="warning">
              {error}
            </Banner>
          )}

          <div>
            {titles.map((title, i) => (
              <TaskTitleRow
                key={i}
                index={i}
                title={title}
                placeholder={formatMessage({ id: "task.create.titlePlaceholder" }, { n: i + 1 })}
                removable={titles.length > 1}
                onChange={updateTitle}
                onRemove={removeRow}
              />
            ))}
            <Button size="sm"
              variant="outline"
              type="button"
              onClick={addRow}
              className="mt-1"
            >
              <Plus size={16} />
              {formatMessage({ id: "task.create.addAnother" })}
            </Button>
          </div>

          <div className="flex justify-end gap-2">
            <Button size="lg"
              variant="ghost"
              type="button"
              onClick={onClose}
            >
              {formatMessage({ id: "common.confirm.cancel" })}
            </Button>
            <Button size="lg"
              variant="accent"
              type="submit"
              disabled={submitting}
            >
              {submitting
                ? formatMessage({ id: "task.create.submitting" })
                : formatMessage(
                  { id: "task.create.submit" },
                  { count: isBatch ? titles.filter((t) => t.trim()).length : 1 },
                )}
            </Button>
          </div>
        </form>
    </DialogCard>
  );
}
