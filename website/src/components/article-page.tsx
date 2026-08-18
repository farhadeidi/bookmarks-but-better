import type { ReactNode } from "react"
import { cn } from "@/lib/cn"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"

interface ArticlePageProps {
  title: string
  intro: string
  children: ReactNode
}

export function ArticlePage({ title, intro, children }: ArticlePageProps) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <p className="font-display text-sm text-primary italic">
          Bookmarks But Better
        </p>
        <h1 className="font-display mt-2 text-4xl font-medium tracking-tight text-balance md:text-5xl">
          {title}
        </h1>
        <p className="mt-5 leading-relaxed text-pretty text-muted-foreground">
          {intro}
        </p>
        <div className={cn("mt-12 space-y-10")}>{children}</div>
      </main>
      <SiteFooter />
    </>
  )
}
