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
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import { useUpdateOption } from '../hooks/use-update-option'

const directPrice = z.number().min(0).max(2147483647)
const directPricesSchema = z.object({
  input: directPrice,
  output: directPrice,
  cache_read: directPrice,
  cache_write: directPrice,
})
const optionSchema = z.record(
  z.string(),
  z.record(
    z.string(),
    z.discriminatedUnion('mode', [
      directPricesSchema.extend({ mode: z.literal('direct') }),
      z.object({ mode: z.literal('ratio') }),
    ])
  )
)
const formSchema = z.object({
  group: z.string().trim().min(1),
  model: z.string().trim().min(1),
  direct: z.boolean(),
  input: z.string(),
  output: z.string(),
  cache_read: z.string(),
  cache_write: z.string(),
})

const priceFields = ['input', 'output', 'cache_read', 'cache_write'] as const
const defaults: z.infer<typeof formSchema> = {
  group: '',
  model: '',
  direct: true,
  input: '',
  output: '',
  cache_read: '',
  cache_write: '',
}

function parsePricingOption(raw: string) {
  let value: unknown
  try {
    value = JSON.parse(raw || '{}') as unknown
  } catch {
    value = null
  }
  return optionSchema.safeParse(value)
}

export function DirectGroupPricingForm(props: { rawValue: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const update = useUpdateOption()
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: defaults,
  })
  const direct = useWatch({ control: form.control, name: 'direct' })
  const parsed = parsePricingOption(props.rawValue)
  const labels = {
    input: t('Input'),
    output: t('Output'),
    cache_read: t('Cache'),
    cache_write: t('Cache Write'),
  }

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!parsed.success) return
    const prices = directPricesSchema.safeParse(
      Object.fromEntries(
        priceFields.map((key) => [
          key,
          values[key].trim() ? Number(values[key]) : undefined,
        ])
      )
    )
    if (values.direct && !prices.success) {
      for (const issue of prices.error.issues) {
        const name = priceFields.find((key) => key === issue.path[0])
        if (name) {
          form.setError(name, { message: t('Enter a valid nonnegative price') })
        }
      }
      return
    }
    const current = Object.hasOwn(parsed.data, values.group)
      ? parsed.data[values.group]
      : {}
    const row =
      values.direct && prices.success
        ? { mode: 'direct' as const, ...prices.data }
        : { mode: 'ratio' as const }
    await update
      .mutateAsync({
        key: 'DirectGroupTokenPricing',
        value: JSON.stringify({
          ...parsed.data,
          [values.group]: { ...current, [values.model]: row },
        }),
      })
      .then(() => queryClient.invalidateQueries({ queryKey: ['pricing'] }))
      .catch(() => undefined)
  }

  return (
    <section className='space-y-3 rounded-lg border p-4'>
      <h2 className='font-medium'>{t('Direct pricing')}</h2>
      <p className='text-muted-foreground text-sm'>
        {t('Fixed groups only. Direct token prices do not use multipliers.')}
      </p>
      <p className='text-muted-foreground text-sm'>
        {t('Prices shown per {{unit}} tokens', { unit: '1M' })} (¥)
      </p>
      <div className='flex flex-wrap gap-2'>
        {Object.entries(parsed.data ?? {}).flatMap(([group, models]) =>
          Object.entries(models)
            .filter(([, row]) => row.mode === 'direct')
            .map(([model, row]) => (
              <Button
                key={JSON.stringify([group, model])}
                type='button'
                size='sm'
                variant='outline'
                onClick={() => {
                  if (row.mode !== 'direct') return
                  form.reset({
                    group,
                    model,
                    direct: true,
                    input: String(row.input),
                    output: String(row.output),
                    cache_read: String(row.cache_read),
                    cache_write: String(row.cache_write),
                  })
                }}
              >
                {group} / {model}
              </Button>
            ))
        )}
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-3'>
          <div className='grid gap-3 sm:grid-cols-2'>
            {(['group', 'model'] as const).map((name) => (
              <FormField
                key={name}
                name={name}
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {name === 'group' ? t('Group') : t('Model')}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </div>
          <FormField
            name='direct'
            control={form.control}
            render={({ field }) => (
              <FormItem className='flex items-center gap-2'>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormLabel>
                  {field.value ? t('Direct pricing') : t('Multiplier pricing')}
                </FormLabel>
              </FormItem>
            )}
          />
          {direct && (
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
              {priceFields.map((name) => (
                <FormField
                  key={name}
                  name={name}
                  control={form.control}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{labels[name]}</FormLabel>
                      <FormControl>
                        <Input {...field} inputMode='decimal' />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
          )}
          <Button type='submit' disabled={update.isPending || !parsed.success}>
            {t('Save')}
          </Button>
        </form>
      </Form>
    </section>
  )
}
