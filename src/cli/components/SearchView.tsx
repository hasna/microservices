import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { searchMicroservices, MicroserviceMeta } from "../../lib/registry.js";

interface SearchViewProps {
  selected: Set<string>;
  onToggle: (name: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}

const COL_CHECK = 5;
const COL_NAME = 20;

export function SearchView({
  selected,
  onToggle,
  onConfirm,
  onBack,
}: SearchViewProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MicroserviceMeta[]>([]);
  const [mode, setMode] = useState<"search" | "select">("search");
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (query.length >= 2) {
      setResults(searchMicroservices(query));
      setCursor(0);
    } else {
      setResults([]);
    }
  }, [query]);

  const hasConfirm = selected.size > 0;
  const totalItems = results.length + 1 + (hasConfirm ? 1 : 0);

  const maxVisible = 14;
  const scrollOffset = useMemo(() => {
    if (totalItems <= maxVisible) return 0;
    const half = Math.floor(maxVisible / 2);
    if (cursor < half) return 0;
    if (cursor > totalItems - maxVisible + half)
      return totalItems - maxVisible;
    return cursor - half;
  }, [cursor, totalItems]);

  useInput((input, key) => {
    if (key.escape) {
      if (mode === "select") {
        setMode("search");
      } else {
        onBack();
      }
      return;
    }

    if (mode === "search") {
      if (key.downArrow && results.length > 0) {
        setMode("select");
        setCursor(0);
      }
      return;
    }

    if (key.upArrow) {
      if (cursor === 0) {
        setMode("search");
      } else {
        setCursor((c) => c - 1);
      }
    } else if (key.downArrow) {
      setCursor((c) => (c < totalItems - 1 ? c + 1 : c));
    } else if (key.return) {
      if (cursor === 0) {
        onBack();
      } else if (hasConfirm && cursor === totalItems - 1) {
        onConfirm();
      } else {
        const idx = cursor - 1;
        if (idx < results.length) {
          onToggle(results[idx].name);
        }
      }
    } else if (input === " " && cursor > 0) {
      const idx = cursor - 1;
      if (idx < results.length) {
        onToggle(results[idx].name);
      }
    } else if (input === "i" && selected.size > 0) {
      onConfirm();
    } else if (input === "a" && mode === "select") {
      const allSelected = results.every((m) => selected.has(m.name));
      for (const m of results) {
        if (allSelected) {
          if (selected.has(m.name)) onToggle(m.name);
        } else {
          if (!selected.has(m.name)) onToggle(m.name);
        }
      }
    }
  });

  const visibleStart = scrollOffset;
  const visibleEnd = Math.min(scrollOffset + maxVisible, totalItems);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Search: </Text>
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Type to search microservices..."
          focus={mode === "search"}
        />
      </Box>

      {query.length < 2 && (
        <Text dimColor>Type at least 2 characters to search</Text>
      )}

      {query.length >= 2 && results.length === 0 && (
        <Text dimColor>No microservices found for "{query}"</Text>
      )}

      {results.length > 0 && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text dimColor>
              Found {results.length} microservice(s)
              {mode === "search" ? " \u2014 press \u2193 to select" : ""}:
            </Text>
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
              const isActive = mode === "select" && cursor === 0;
              return (
                <Box key="__back__">
                  <Text
                    color={isActive ? "cyan" : undefined}
                    bold={isActive}
                  >
                    {isActive ? "\u276F " : "  "}\u2190 Back
                  </Text>
                </Box>
              );
            }

            if (hasConfirm && idx === totalItems - 1) {
              const isActive = mode === "select" && cursor === totalItems - 1;
              return (
                <Box key="__confirm__">
                  <Text
                    color="green"
                    bold={isActive}
                    dimColor={!isActive}
                  >
                    {isActive ? "\u276F " : "  "}\u2713 Install selected (
                    {selected.size})
                  </Text>
                </Box>
              );
            }

            const m = results[idx - 1];
            if (!m) return null;
            const isActive = mode === "select" && cursor === idx;
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
                  <Text
                    bold={isActive}
                    color={isActive ? "cyan" : undefined}
                  >
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
        </Box>
      )}

      {selected.size > 0 && (
        <Box marginTop={1}>
          <Text dimColor>Selected: {Array.from(selected).join(", ")}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {mode === "search"
            ? "type to search  \u2193 select results  esc back"
            : "\u2191\u2193 navigate  space/enter toggle  a select all  i install  esc search"}
        </Text>
      </Box>
    </Box>
  );
}
