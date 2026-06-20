import Block from "components/services/widget/block";
import Container from "components/services/widget/container";
import useWidgetAPI from "utils/proxy/use-widget-api";

export default function Component({ service }) {
  const { widget } = service;

  const { data, error } = useWidgetAPI(widget, "stats", {
    refreshInterval: 10000,
  });

  const getFieldsToRender = () => {
    const booleanKeys = [
      "showPlan", "showLimit", "showRemaining", "showUsed", "showReset",
      "showGeminiUsed", "showGeminiRemaining", "showGeminiReset", "showGeminiModel",
      "showClaudeGptUsed", "showClaudeGptRemaining", "showClaudeGptReset", "showClaudeGptModel",
      "showGemini5hUsed", "showGemini5hRemaining", "showGemini5hReset", "showGemini5hModel",
      "showClaudeGpt5hUsed", "showClaudeGpt5hRemaining", "showClaudeGpt5hReset", "showClaudeGpt5hModel",
      "showGeminiWeekUsed", "showGeminiWeekRemaining", "showGeminiWeekReset", "showGeminiWeekModel",
      "showClaudeGptWeekUsed", "showClaudeGptWeekRemaining", "showClaudeGptWeekReset", "showClaudeGptWeekModel"
    ];

    const hasAnyConfig = booleanKeys.some(key => widget[key] !== undefined);

    if (hasAnyConfig) {
      const fields = [];
      if (widget.showPlan) fields.push({ key: "plan", label: "Тариф", path: "plan" });
      if (widget.showLimit) fields.push({ key: "limit", label: "Лимит", path: "limit" });
      if (widget.showRemaining) fields.push({ key: "remaining", label: "Осталось", path: "remaining" });
      if (widget.showUsed) fields.push({ key: "used", label: "Использовано", path: "used" });
      if (widget.showReset) fields.push({ key: "reset", label: "КД", path: "reset" });

      if (widget.showGeminiUsed) fields.push({ key: "gemini_used", label: "G: Использовано", path: "gemini_used" });
      if (widget.showGeminiRemaining) fields.push({ key: "gemini_remaining", label: "G: Осталось", path: "gemini_remaining" });
      if (widget.showGeminiReset) fields.push({ key: "gemini_reset", label: "G: КД", path: "gemini_reset" });
      if (widget.showGeminiModel) fields.push({ key: "gemini_model", label: "G: Модель", path: "gemini_model" });

      if (widget.showClaudeGptUsed) fields.push({ key: "claude_gpt_used", label: "C/GPT: Использовано", path: "claude_gpt_used" });
      if (widget.showClaudeGptRemaining) fields.push({ key: "claude_gpt_remaining", label: "C/GPT: Осталось", path: "claude_gpt_remaining" });
      if (widget.showClaudeGptReset) fields.push({ key: "claude_gpt_reset", label: "C/GPT: КД", path: "claude_gpt_reset" });
      if (widget.showClaudeGptModel) fields.push({ key: "claude_gpt_model", label: "C/GPT: Модель", path: "claude_gpt_model" });

      if (widget.showGemini5hUsed) fields.push({ key: "gemini_5h_used", label: "G (5ч): Использовано", path: "gemini_5h_used" });
      if (widget.showGemini5hRemaining) fields.push({ key: "gemini_5h_remaining", label: "G (5ч): Осталось", path: "gemini_5h_remaining" });
      if (widget.showGemini5hReset) fields.push({ key: "gemini_5h_reset", label: "G (5ч): КД", path: "gemini_5h_reset" });
      if (widget.showGemini5hModel) fields.push({ key: "gemini_5h_model", label: "G (5ч): Модель", path: "gemini_5h_model" });

      if (widget.showClaudeGpt5hUsed) fields.push({ key: "claude_gpt_5h_used", label: "C/GPT (5ч): Использовано", path: "claude_gpt_5h_used" });
      if (widget.showClaudeGpt5hRemaining) fields.push({ key: "claude_gpt_5h_remaining", label: "C/GPT (5ч): Осталось", path: "claude_gpt_5h_remaining" });
      if (widget.showClaudeGpt5hReset) fields.push({ key: "claude_gpt_5h_reset", label: "C/GPT (5ч): КД", path: "claude_gpt_5h_reset" });
      if (widget.showClaudeGpt5hModel) fields.push({ key: "claude_gpt_5h_model", label: "C/GPT (5ч): Модель", path: "claude_gpt_5h_model" });

      if (widget.showGeminiWeekUsed) fields.push({ key: "gemini_week_used", label: "G (нед): Использовано", path: "gemini_week_used" });
      if (widget.showGeminiWeekRemaining) fields.push({ key: "gemini_week_remaining", label: "G (нед): Осталось", path: "gemini_week_remaining" });
      if (widget.showGeminiWeekReset) fields.push({ key: "gemini_week_reset", label: "G (нед): КД", path: "gemini_week_reset" });
      if (widget.showGeminiWeekModel) fields.push({ key: "gemini_week_model", label: "G (нед): Модель", path: "gemini_week_model" });

      if (widget.showClaudeGptWeekUsed) fields.push({ key: "claude_gpt_week_used", label: "C/GPT (нед): Использовано", path: "claude_gpt_week_used" });
      if (widget.showClaudeGptWeekRemaining) fields.push({ key: "claude_gpt_week_remaining", label: "C/GPT (нед): Осталось", path: "claude_gpt_week_remaining" });
      if (widget.showClaudeGptWeekReset) fields.push({ key: "claude_gpt_week_reset", label: "C/GPT (нед): КД", path: "claude_gpt_week_reset" });
      if (widget.showClaudeGptWeekModel) fields.push({ key: "claude_gpt_week_model", label: "C/GPT (нед): Модель", path: "claude_gpt_week_model" });

      return fields;
    }

    return [
      { key: "plan", label: "Тариф", path: "plan" },
      { key: "limit", label: "Лимит", path: "limit" },
      { key: "remaining", label: "Осталось", path: "remaining" },
      { key: "reset", label: "КД", path: "reset" }
    ];
  };

  if (error) {
    return <Container service={service} error={error} />;
  }

  const fields = getFieldsToRender();

  return (
    <Container service={service}>
      {fields.map(({ key, label, path }) => (
        <Block
          key={key}
          field={`antigravity.${key}`}
          label={label}
          value={data ? data[path] : undefined}
        />
      ))}
    </Container>
  );
}
