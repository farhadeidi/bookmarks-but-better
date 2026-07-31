;(() => {
  const root = document.documentElement

  try {
    const savedTheme = localStorage.getItem("theme")
    const theme =
      savedTheme === "light" ||
      savedTheme === "dark" ||
      savedTheme === "system"
        ? savedTheme
        : "dark"
    const resolvedTheme =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme

    root.classList.add(resolvedTheme)
    root.style.colorScheme = resolvedTheme
  } catch {
    root.classList.add("dark")
    root.style.colorScheme = "dark"
  }
})()
