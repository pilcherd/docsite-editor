import React from 'react';

const selections = new Map();
export default function PreviewTabs({
  children,
  values,
  defaultValue,
  groupId,
  lazy = false,
  className = '',
  ...props
}) {
  const items = React.Children.toArray(children).filter(React.isValidElement);
  const choices =
    values ||
    items.map((item) => ({
      value: item.props.value,
      label: item.props.label,
      attributes: item.props.attributes,
    }));
  const first =
    defaultValue !== undefined
      ? defaultValue
      : (items.find((item) => item.props.default)?.props.value ?? choices[0]?.value);
  const [selected, setSelected] = React.useState(() =>
    groupId &&
    selections.has(groupId) &&
    choices.some((choice) => choice.value === selections.get(groupId))
      ? selections.get(groupId)
      : first,
  );
  const key = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
  React.useEffect(() => {
    const listen = (event) => {
      if (
        event.detail.groupId === groupId &&
        choices.some((choice) => choice.value === event.detail.value)
      )
        setSelected(event.detail.value);
    };
    window.addEventListener('site-editor-tab-select', listen);
    return () => window.removeEventListener('site-editor-tab-select', listen);
  }, [groupId, choices]);
  function choose(value) {
    setSelected(value);
    if (groupId) {
      selections.set(groupId, value);
      window.dispatchEvent(
        new CustomEvent('site-editor-tab-select', { detail: { groupId, value } }),
      );
    }
  }
  return (
    <div className={'tabs-container ' + className}>
      <ul role="tablist" aria-label={props['aria-label'] || 'Documentation tabs'} className="tabs">
        {choices.map((choice, index) => (
          <li key={choice.value} role="presentation">
            <button
              {...choice.attributes}
              type="button"
              role="tab"
              id={key + '-tab-' + index}
              aria-selected={selected === choice.value}
              aria-controls={key + '-panel-' + index}
              tabIndex={selected === choice.value ? 0 : -1}
              className={'tabs__item ' + (selected === choice.value ? 'tabs__item--active' : '')}
              onClick={() => choose(choice.value)}
              onKeyDown={(event) => {
                let next;
                if (event.key === 'ArrowRight') next = (index + 1) % choices.length;
                if (event.key === 'ArrowLeft') next = (index - 1 + choices.length) % choices.length;
                if (event.key === 'Home') next = 0;
                if (event.key === 'End') next = choices.length - 1;
                if (next !== undefined) {
                  event.preventDefault();
                  choose(choices[next].value);
                  document.getElementById(key + '-tab-' + next)?.focus();
                }
              }}
            >
              {choice.label ?? choice.value}
            </button>
          </li>
        ))}
      </ul>
      {choices.map((choice, index) => {
        const child = items.find((item) => item.props.value === choice.value),
          active = selected === choice.value;
        return !lazy || active ? (
          <section
            key={choice.value}
            role="tabpanel"
            id={key + '-panel-' + index}
            aria-labelledby={key + '-tab-' + index}
            hidden={!active}
          >
            {child?.props.children}
          </section>
        ) : null;
      })}
    </div>
  );
}
