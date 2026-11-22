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
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatLocalCurrencyAmount } from '@/lib/currency'

import type { getDirectGroupPrices } from '../lib/model-helpers'

export function DirectGroupPrices(props: {
  prices: ReturnType<typeof getDirectGroupPrices>
  cacheOnly?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <div className='min-w-0 space-y-1 text-xs' aria-label={t('Direct pricing')}>
      <div className='text-muted-foreground'>
        {t('Direct pricing')} ·{' '}
        {t('Prices shown per {{unit}} tokens', { unit: '1M' })}
      </div>
      {props.prices.map(([group, price]) => (
        <dl
          key={group}
          className='flex flex-wrap gap-x-2 gap-y-1 text-xs tabular-nums'
        >
          <dt className='font-medium break-all'>{group}</dt>
          {(
            [
              ...(!props.cacheOnly
                ? ([
                    [t('Input'), price.input],
                    [t('Output'), price.output],
                  ] as const)
                : []),
              [t('Cache'), price.cache_read],
              [t('Cache Write'), price.cache_write],
            ] as const
          ).map(([label, value]) => (
            <dd key={label}>
              {label}:{' '}
              {formatLocalCurrencyAmount(value, {
                digitsLarge: 6,
                digitsSmall: 8,
                locale,
              })}
            </dd>
          ))}
        </dl>
      ))}
    </div>
  )
}
