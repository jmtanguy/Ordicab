import type { ReactNode } from 'react'

import {
  Field,
  Input,
  Select,
  type ControlDensity,
  type FieldDensity
} from '@renderer/components/ui'

import type { DiscountMode } from './billingDiscountEditor'

interface DossierDiscountFieldsProps {
  mode: DiscountMode
  percent: string
  amount: string
  modeLabel: ReactNode
  noneLabel: string
  percentModeLabel: string
  amountModeLabel: string
  percentLabel: string
  amountLabel: string
  density?: FieldDensity & ControlDensity
  onModeChange: (mode: DiscountMode) => void
  onPercentChange: (value: string) => void
  onAmountChange: (value: string) => void
}

export function DossierDiscountFields({
  mode,
  percent,
  amount,
  modeLabel,
  noneLabel,
  percentModeLabel,
  amountModeLabel,
  percentLabel,
  amountLabel,
  density,
  onModeChange,
  onPercentChange,
  onAmountChange
}: DossierDiscountFieldsProps): React.JSX.Element {
  return (
    <>
      <Field label={modeLabel} density={density}>
        <Select
          density={density}
          value={mode}
          onChange={(event) => onModeChange(event.target.value as DiscountMode)}
        >
          <option value="none">{noneLabel}</option>
          <option value="percent">{percentModeLabel}</option>
          <option value="amount">{amountModeLabel}</option>
        </Select>
      </Field>
      {mode === 'amount' ? (
        <Field label={amountLabel} density={density}>
          <Input
            density={density}
            inputMode="decimal"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
          />
        </Field>
      ) : (
        <Field label={percentLabel} density={density}>
          <Input
            density={density}
            inputMode="decimal"
            value={mode === 'percent' ? percent : ''}
            disabled={mode === 'none'}
            onChange={(event) => onPercentChange(event.target.value)}
          />
        </Field>
      )}
    </>
  )
}
