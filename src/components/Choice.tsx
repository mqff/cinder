import { Combobox } from "@base-ui/react/combobox";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import {
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject
} from "react";
import type { IconKey } from "@/lib/icons";
import { fmt } from "@/lib/format";
import { Glyph } from "./Glyph";

interface ChoiceOption {
  value: string;
  label: string;
  count?: number;
}

type ChoiceVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>;

function ChoiceRow({
  option,
  index,
  style,
  size
}: {
  option: ChoiceOption;
  index: number;
  style?: CSSProperties;
  size?: number;
}) {
  return (
    <Combobox.Item
      value={option.value}
      index={index}
      className="choice-option"
      data-value={option.value}
      title={option.label}
      style={style}
      aria-setsize={size}
      aria-posinset={size ? index + 1 : undefined}
    >
      <Combobox.ItemIndicator className="choice-check">
        <Glyph name="check" size={14} />
      </Combobox.ItemIndicator>
      <span className="choice-option-label">{option.label}</span>
      {option.count !== undefined && <span className="choice-count">{fmt.compact(option.count)}</span>}
    </Combobox.Item>
  );
}

function VirtualChoices({ virtualizerRef }: { virtualizerRef: RefObject<ChoiceVirtualizer | null> }) {
  const options = Combobox.useFilteredItems<ChoiceOption>();
  const scroll = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: options.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 34,
    overscan: 5
  });
  useImperativeHandle(virtualizerRef, () => virtualizer, [virtualizer]);
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      scroll.current = element;
      if (element) virtualizer.measure();
    },
    [virtualizer]
  );
  return (
    options.length > 0 && (
      <div
        ref={attach}
        className="choice-virtual-scroll"
        role="presentation"
        style={{ height: Math.min(options.length * 34, 306) }}
      >
        <div className="choice-virtual-space" role="presentation" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => (
            <ChoiceRow
              key={options[row.index].value}
              option={options[row.index]}
              index={row.index}
              size={options.length}
              style={{
                position: "absolute",
                width: "100%",
                height: row.size,
                top: 0,
                left: 0,
                transform: `translateY(${row.start}px)`
              }}
            />
          ))}
        </div>
      </div>
    )
  );
}

export const Choice = memo(function Choice({
  label,
  value,
  options,
  onChange,
  icon,
  active = false,
  wide = false
}: {
  label: string;
  value: string;
  options: ChoiceOption[];
  onChange: (value: string) => void;
  icon?: IconKey;
  active?: boolean;
  wide?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const virtualizer = useRef<ChoiceVirtualizer | null>(null);
  const virtualized = options.length > 200;
  const items = useMemo(
    () => Combobox.createItems(options, { getValue: (option) => option.value, getLabel: (option) => option.label }),
    [options]
  );
  const selected = options.find((option) => option.value === value);
  return (
    <Combobox.Root
      items={items}
      value={value}
      open={open}
      autoHighlight
      virtualized={virtualized}
      onItemHighlighted={(_item, { index, reason }) => {
        if (virtualized && reason !== "pointer" && index >= 0)
          queueMicrotask(() => virtualizer.current?.scrollToIndex(index, { align: "auto" }));
      }}
      onOpenChange={(next) => {
        if (next) setContainer(trigger.current?.closest("dialog") || document.body);
        setOpen(next);
      }}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <Combobox.Trigger
        ref={trigger}
        className="choice-trigger"
        aria-label={label}
        title={selected?.label || value}
        data-active={active || undefined}
      >
        {icon && <Glyph name={icon} size={14} />}
        <span className="choice-label">{selected?.label || value}</span>
        <Glyph name="chevron" size={14} />
      </Combobox.Trigger>
      <Combobox.Portal container={container}>
        <Combobox.Positioner
          className="choice-positioner"
          sideOffset={6}
          collisionPadding={12}
          positionMethod="fixed"
          align="start"
        >
          <Combobox.Popup
            className={`choice-popup${wide ? " choice-popup-wide" : ""}`}
            initialFocus={input}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }}
          >
            <div className="choice-search">
              <Glyph name="search" size={15} />
              <Combobox.Input
                ref={input}
                aria-label={`Search ${label.toLowerCase()}`}
                placeholder={`Search ${label.toLowerCase()}...`}
              />
            </div>
            <Combobox.Empty>
              <div className="choice-empty">No matches</div>
            </Combobox.Empty>
            <Combobox.List className={`choice-list${virtualized ? " choice-list-virtual" : ""}`}>
              {virtualized ? (
                <VirtualChoices virtualizerRef={virtualizer} />
              ) : (
                (option: ChoiceOption, index: number) => <ChoiceRow key={option.value} option={option} index={index} />
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
});
