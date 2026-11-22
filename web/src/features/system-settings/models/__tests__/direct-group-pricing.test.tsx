/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { DirectGroupPricingForm } from '../direct-group-pricing-form'

const save = vi.hoisted(() => vi.fn())
vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  updateSystemOption: save,
}))

it('blocks missing prices, then saves an explicit zero for the selected model and group', async () => {
  save.mockResolvedValue({ success: true })
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  try {
    render(
      <QueryClientProvider client={client}>
        <DirectGroupPricingForm rawValue='{}' />
      </QueryClientProvider>
    )
    fireEvent.change(screen.getByLabelText('Group'), {
      target: { value: 'default' },
    })
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'GPT-6.1-Sol' },
    })
    fireEvent.change(screen.getByLabelText('Input'), {
      target: { value: '0.49' },
    })
    fireEvent.change(screen.getByLabelText('Output'), {
      target: { value: '0.95' },
    })
    fireEvent.change(screen.getByLabelText('Cache Write'), {
      target: { value: '0.59' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Cache')).toHaveAttribute(
        'aria-invalid',
        'true'
      )
    )
    expect(save).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Cache'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        key: 'DirectGroupTokenPricing',
        value: JSON.stringify({
          default: {
            'GPT-6.1-Sol': {
              mode: 'direct',
              input: 0.49,
              output: 0.95,
              cache_read: 0,
              cache_write: 0.59,
            },
          },
        }),
      })
    )
  } finally {
    client.clear()
    save.mockReset()
  }
})
