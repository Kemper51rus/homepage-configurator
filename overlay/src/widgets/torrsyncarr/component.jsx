import Block from "components/services/widget/block";
import Container from "components/services/widget/container";
import useWidgetAPI from "utils/proxy/use-widget-api";

export default function Component({ service }) {
  const { widget } = service;

  const { data, error } = useWidgetAPI(widget, "stats", {
    refreshInterval: 10000,
  });

  const getFieldsToRender = () => {
    if (widget.fields && Array.isArray(widget.fields)) {
      return widget.fields;
    }
    const defaults = ["movies", "series", "anime", "cartoons"];
    if (widget.enableWaitingCount) {
      defaults.push("waiting");
    }
    return defaults;
  };

  const renderBlock = (field, hasValue) => {
    const norm = String(field).toLowerCase().trim();
    if (norm === "movies" || norm === "films" || norm === "фильмы") {
      return (
        <Block
          key="movies"
          field="torrsyncarr.movies"
          label="Фильмы"
          value={hasValue ? data?.movies : undefined}
        />
      );
    }
    if (norm === "series" || norm === "сериалы") {
      return (
        <Block
          key="series"
          field="torrsyncarr.series"
          label="Сериалы"
          value={hasValue ? data?.series : undefined}
        />
      );
    }
    if (norm === "anime" || norm === "аниме") {
      return (
        <Block
          key="anime"
          field="torrsyncarr.anime"
          label="Аниме"
          value={hasValue ? data?.anime : undefined}
        />
      );
    }
    if (norm === "cartoons" || norm === "мультфильмы") {
      return (
        <Block
          key="cartoons"
          field="torrsyncarr.cartoons"
          label="Мультфильмы"
          value={hasValue ? data?.cartoons : undefined}
        />
      );
    }
    if (norm === "waiting" || norm === "import" || norm === "ожидают импорта" || norm === "импорт") {
      return (
        <Block
          key="waiting"
          field="torrsyncarr.import"
          label="Ожидают импорта"
          value={hasValue ? data?.waitingForImport : undefined}
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
