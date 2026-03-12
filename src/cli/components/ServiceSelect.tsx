import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { MicroserviceMeta } from "../../lib/registry.js";

interface ServiceSelectProps {
  services: MicroserviceMeta[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}

const COL_CHECK = 5;
const COL_NAME = 20;

export function ServiceSelect({
  services,
  selected,
  onToggle,
  onConfirm,
  onBack,
}: ServiceSelectProps) {
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState("");

  const filteredServices = useMemo(() => {
    if (!filter) return services;
    const lower = filter.toLowerCase();
    return services.filter(
      (m) =>
        m.name.toLowerCase().includes(lower) ||
        m.description.toLowerCase().includes(lower)
    );
  }, [services, filter]);

  const totalItems = filteredServices.length + 2;

  const clampedCursor = useMemo(() => {
    if (cursor >= totalItems) return totalItems - 1;
    return cursor;
  }, [cursor, totalItems]);

  const maxVisible = 16;
  const scrollOffset = useMemo(() => {
    if (totalItems <= maxVisible) return 0;
    const half = Math.floor(maxVisible / 2);
    if (clampedCursor < half) return 0;
    if (clampedCursor > totalItems - maxVisible + half)
      return totalItems - maxVisible;
    return clampedCursor - half;
  }, [clampedCursor, totalItems]);

  useInput((input, key) => {
    if (key.escape) {
      if (filter) {
        setFilter("");
        setCursor(0);
      } else {
        onBack();
      }
    } else if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : totalItems - 1));
    } else if (key.downArrow) {
      setCursor((c) => (c < totalItems - 1 ? c + 1 : 0));
    } else if (key.return) {
      if (clampedCursor === 0) {
        onBack();
      } else if (clampedCursor === totalItems - 1) {
        if (selected.size > 0) onConfirm();
      } else {
        onToggle(filteredServices[clampedCursor - 1].name);
      }
    } else if (
      input === " " &&
      clampedCursor > 0 &&
      clampedCursor < filteredServices.length + 1
    ) {
      onToggle(filteredServices[clampedCursor - 1].name);
    } else if (input === "i" && selected.size > 0) {
      onConfirm();
    } else if (input === "a") {
      const allSelected = filteredServices.every((m) => selected.has(m.name));
      for (const m of filteredServices) {
        if (allSelected) {
          if (selected.has(m.name)) onToggle(m.name);
        } else {
          if (!selected.has(m.name)) onToggle(m.name);
        }
      }
    } else if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      setCursor(0);
    } else if (
      input &&
      /^[a-zA-Z0-9\-_.]$/.test(input) &&
      input !== "a" &&
      input !== "i"
    ) {
      setFilter((f) => f + input);
      setCursor(0);
    }
  });

  const visibleStart = scrollOffset;
  const visibleEnd = Math.min(scrollOffset + maxVisible, totalItems);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Select microservices to install:</Text>
        {filter ? <Text color="yellow"> Filter: {filter}</Text> : null}
        {filter && filteredServices.length === 0 ? (
          <Text dimColor> (no matches)</Text>
        ) : filter ? (
          <Text dimColor>
            {" "}
            ({filteredServices.length} match
            {filteredServices.length !== 1 ? "es" : ""})
          </Text>
        ) : null}
      </Box>

      <Box>
        <Box width={COL_CHECK}>
          <Text dimColor> </Text>
        </Box>
        <Box width={COL_NAME}>
          <Text bold dimColor>
            Service
          </Text>
        </Box>
        <Text bold dimColor>
          Description
        </Text>
      </Box>

      <Box marginBottom={0}>
        <Text dimColor>{"\u2500".repeat(70)}</Text>
      </Box>

      {visibleStart > 0 && (
        <Text dimColor> \u2191 {visibleStart} more</Text>
      )}

      {Array.from({ length: visibleEnd - visibleStart }, (_, i) => {
        const idx = visibleStart + i;

        if (idx === 0) {
          const isActive = clampedCursor === 0;
          return (
            <Box key="__back__">
              <Text color={isActive ? "cyan" : undefined} bold={isActive}>
                {isActive ? "\u276F " : "  "}\u2190 Back to categories
              </Text>
            </Box>
          );
        }

        if (idx === totalItems - 1) {
          const isActive = clampedCursor === totalItems - 1;
          const hasSelection = selected.size > 0;
          return (
            <Box key="__confirm__">
              <Text
                color={hasSelection ? "green" : "gray"}
                bold={isActive}
                dimColor={!hasSelection}
              >
                {isActive ? "\u276F " : "  "}\u2713 Install selected (
                {selected.size})
              </Text>
            </Box>
          );
        }

        const m = filteredServices[idx - 1];
        const isActive = clampedCursor === idx;
        const isChecked = selected.has(m.name);

        return (
          <Box key={m.name}>
            <Box width={2}>
              <Text color={isActive ? "cyan" : undefined}>
                {isActive ? "\u276F" : " "}
              </Text>
            </Box>
            <Box width={COL_CHECK - 2}>
              <Text color={isChecked ? "green" : "gray"}>
                {isChecked ? "[\u2713]" : "[ ]"}
              </Text>
            </Box>
            <Box width={COL_NAME}>
              <Text bold={isActive} color={isActive ? "cyan" : undefined}>
                {m.name}
              </Text>
            </Box>
            <Text wrap="truncate">{m.description}</Text>
          </Box>
        );
      })}

      {visibleEnd < totalItems && (
        <Text dimColor> \u2193 {totalItems - visibleEnd} more</Text>
      )}

      {selected.size > 0 && (
        <Box marginTop={1}>
          <Text dimColor>Selected: {Array.from(selected).join(", ")}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          \u2191\u2193 navigate space/enter toggle a select all i install type
          to filter esc {filter ? "clear filter" : "back"}
        </Text>
      </Box>
    </Box>
  );
}
