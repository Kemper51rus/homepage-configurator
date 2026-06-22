import Block from "components/services/widget/block";
import Container from "components/services/widget/container";
import useWidgetAPI from "utils/proxy/use-widget-api";

export default function Component({ service }) {
  const { widget } = service;

  const { data, error } = useWidgetAPI(widget, "stats", {
    refreshInterval: 300000,
  });

  const getFieldsToRender = () => {
    const hasAnyConfig = 
      widget.showPlan !== undefined ||
      widget.showRemaining !== undefined ||
      widget.showReset !== undefined ||
      widget.showUsed !== undefined ||
      widget.showPlanEnds !== undefined;

    if (hasAnyConfig) {
      const fields = [];
      if (widget.showPlan) fields.push("plan");
      if (widget.showRemaining) fields.push("remaining");
      if (widget.showReset) fields.push("reset");
      if (widget.showUsed) fields.push("used");
      if (widget.showPlanEnds) fields.push("plan_ends");
      return fields;
    }

    return ["plan", "remaining", "reset"];
  };

  const renderBlock = (field, hasValue) => {
    if (field === "plan") {
      return (
        <Block
          key="plan"
          field="codex.plan"
          label="Тариф"
          value={hasValue ? data?.plan : undefined}
        />
      );
    }
    if (field === "remaining") {
      return (
        <Block
          key="remaining"
          field="codex.remaining"
          label="Осталось"
          value={hasValue ? data?.remaining : undefined}
        />
      );
    }
    if (field === "reset") {
      return (
        <Block
          key="reset"
          field="codex.reset"
          label="КД"
          value={hasValue ? data?.reset : undefined}
        />
      );
    }
    if (field === "used") {
      return (
        <Block
          key="used"
          field="codex.used"
          label="Использовано"
          value={hasValue ? data?.used : undefined}
        />
      );
    }
    if (field === "plan_ends") {
      return (
        <Block
          key="plan_ends"
          field="codex.plan_ends"
          label="Истекает"
          value={hasValue ? data?.plan_ends : undefined}
        />
      );
    }
    return null;
  };

  if (error) {
    return <Container service={service} error={error} />;
  }

  const fields = getFieldsToRender();

  if (!data) {
    return (
      <Container service={service}>
        {fields.map((f) => renderBlock(f, false))}
      </Container>
    );
  }

  return (
    <Container service={service}>
      {fields.map((f) => renderBlock(f, true))}
    </Container>
  );
}
