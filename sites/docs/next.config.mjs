import nextra from 'nextra'

const withNextra = nextra({
  // Nextra options
})

export default withNextra({
  output: 'export',
  images: {
    unoptimized: true,
  },
})
