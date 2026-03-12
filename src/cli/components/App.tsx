import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import { Header } from "./Header.js";
import { CategorySelect } from "./CategorySelect.js";
import { ServiceSelect } from "./ServiceSelect.js";
import { SearchView } from "./SearchView.js";
import { InstallProgress } from "./InstallProgress.js";
import {
  getMicroservicesByCategory,
  MicroserviceMeta,
  Category,
} from "../../lib/registry.js";
import { InstallResult } from "../../lib/installer.js";

type View =
  | "main"
  | "browse"
  | "search"
  | "services"
  | "installing"
  | "done";

interface AppProps {
  initialServices?: string[];
  overwrite?: boolean;
}

export function App({ initialServices, overwrite = false }: AppProps) {
  const { exit } = useApp();
  const [view, setView] = useState<View>(
    initialServices?.length ? "installing" : "main"
  );
  const [category, setCategory] = useState<Category | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialServices || [])
  );
  const [results, setResults] = useState<InstallResult[]>([]);

  useInput((input, key) => {
    if (key.escape) {
      if (view === "main") {
        exit();
      } else if (view === "browse" || view === "search") {
        setView("main");
      } else if (view === "services") {
        setCategory(null);
        setView("browse");
      }
    }
    if (input === "q" && view !== "search") {
      exit();
    }
  });

  const handleToggle = (name: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelected(newSelected);
  };

  const handleConfirm = () => {
    if (selected.size > 0) {
      setView("installing");
    }
  };

  const handleComplete = (installResults: InstallResult[]) => {
    setResults(installResults);
    setView("done");
  };

  const mainMenuItems = [
    { label: "Browse by category", value: "browse" },
    { label: "Search microservices", value: "search" },
    { label: "Exit", value: "exit" },
  ];

  const handleMainSelect = (item: { value: string }) => {
    if (item.value === "exit") {
      exit();
    } else {
      setView(item.value as View);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Header
        title="Microservices"
        subtitle="Mini business apps for AI agents"
      />

      {view === "main" && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text>What would you like to do?</Text>
          </Box>
          <SelectInput items={mainMenuItems} onSelect={handleMainSelect} />
          <Box marginTop={1}>
            <Text dimColor>Press q to quit</Text>
          </Box>
        </Box>
      )}

      {view === "browse" && !category && (
        <CategorySelect
          onSelect={(cat) => {
            setCategory(cat as Category);
            setView("services");
          }}
          onBack={() => setView("main")}
        />
      )}

      {view === "services" && category && (
        <ServiceSelect
          services={getMicroservicesByCategory(category)}
          selected={selected}
          onToggle={handleToggle}
          onConfirm={handleConfirm}
          onBack={() => {
            setCategory(null);
            setView("browse");
          }}
        />
      )}

      {view === "search" && (
        <SearchView
          selected={selected}
          onToggle={handleToggle}
          onConfirm={handleConfirm}
          onBack={() => setView("main")}
        />
      )}

      {view === "installing" && (
        <InstallProgress
          services={Array.from(selected)}
          overwrite={overwrite}
          onComplete={handleComplete}
        />
      )}

      {view === "done" && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold color="green">
              Installation complete!
            </Text>
          </Box>

          {results.filter((r) => r.success).length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold>Installed:</Text>
              {results
                .filter((r) => r.success)
                .map((r) => (
                  <Text key={r.microservice} color="green">
                    {"\u2713"} {r.microservice}
                  </Text>
                ))}
            </Box>
          )}

          {results.filter((r) => !r.success).length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color="red">
                Failed:
              </Text>
              {results
                .filter((r) => !r.success)
                .map((r) => (
                  <Text key={r.microservice} color="red">
                    {"\u2717"} {r.microservice}: {r.error}
                  </Text>
                ))}
            </Box>
          )}

          <Box marginTop={1} flexDirection="column">
            <Text bold>Next steps:</Text>
            <Text>
              1. Run a microservice: microservices run contacts list
            </Text>
            <Text>
              2. Check status: microservices status
            </Text>
            <Text>3. Each service has its own SQLite database</Text>
          </Box>

          <Box marginTop={1}>
            <Text dimColor>Press q to exit</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
