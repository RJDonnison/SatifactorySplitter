import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('loads with the default demo problem', async ({ page }) => {
  await expect(page).toHaveTitle('Satisfactory Splitter Planner')
  await expect(
    page.getByRole('heading', { name: 'Inputs', level: 2 }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Outputs', level: 2 }),
  ).toBeVisible()
  // default 780 -> 390 + 390 renders one splitter and two outputs
  await expect(page.getByText('780/min').first()).toBeVisible()
  await expect(page.getByText('390/min').first()).toBeVisible()
  await expect(page.getByText('Output 1').first()).toBeVisible()
})

test('solves the belt-tap example 780 -> 180 + 600', async ({ page }) => {
  const spinbuttons = page.getByRole('spinbutton')
  await spinbuttons.nth(1).fill('180')
  await spinbuttons.nth(2).fill('600')

  await expect(page.getByText('Mk.2 tap').first()).toBeVisible()
  await expect(page.getByText('Mk.1 tap').first()).toBeVisible()
  await expect(page.getByText('180/min').first()).toBeVisible()
  await expect(page.getByText('600/min').first()).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Build summary' }),
  ).toBeVisible()
})

test('restores a shared problem from the url', async ({ page }) => {
  await page.goto('/?s=eyJpIjpbNzgwXSwibyI6WzE4MCw2MDBdLCJ0IjowLjAxfQ')
  await expect(page.getByRole('spinbutton').nth(1)).toHaveValue('180')
  await expect(page.getByRole('spinbutton').nth(2)).toHaveValue('600')
  await expect(page.getByText('Mk.2 tap').first()).toBeVisible()
})

test('shows an error when outputs exceed input', async ({ page }) => {
  const spinbuttons = page.getByRole('spinbutton')
  await spinbuttons.nth(1).fill('600')
  await spinbuttons.nth(2).fill('600')
  await expect(page.getByText(/exceed the input/i).first()).toBeVisible()
})
