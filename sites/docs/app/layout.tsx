import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'

export const metadata = {
  title: 'ARRAKIS Docs',
  description: 'Documentation for ARRAKIS - Engagement Intelligence for Web3',
  icons: {
    icon: '/favicon.svg',
  },
}

const navbar = (
  <Navbar
    logo={<span style={{ fontWeight: 700, fontFamily: 'monospace' }}>ARRAKIS // docs</span>}
    projectLink="https://github.com/0xHoneyJar/arrakis"
    chatLink="https://discord.gg/thehoneyjar"
  />
)

const footer = (
  <Footer>
    © {new Date().getFullYear()} The Honey Jar Corp. Built with Nextra.
  </Footer>
)

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/0xHoneyJar/arrakis/tree/main/docs-site"
          footer={footer}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
