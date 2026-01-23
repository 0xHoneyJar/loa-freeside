import {
  TextField,
  NumberField,
  SelectField,
  ToggleField,
  ColorField,
  ContractField,
} from './fields';

interface PropertySchema {
  type: 'string' | 'number' | 'boolean' | 'select' | 'color' | 'contract';
  title?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  enumNames?: string[];
  minimum?: number;
  maximum?: number;
  multiline?: boolean;
}

interface PropertyFieldProps {
  name: string;
  schema: PropertySchema;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  disabled?: boolean;
}

export function PropertyField({
  name,
  schema,
  value,
  onChange,
  error,
  disabled = false,
}: PropertyFieldProps) {
  const label = schema.title || formatLabel(name);

  switch (schema.type) {
    case 'string':
      if (schema.enum) {
        const options = schema.enum.map((val, i) => ({
          value: val,
          label: schema.enumNames?.[i] || val,
        }));
        return (
          <SelectField
            label={label}
            value={value as string || ''}
            onChange={onChange}
            options={options}
            error={error}
            disabled={disabled}
          />
        );
      }
      return (
        <TextField
          label={label}
          value={value as string || ''}
          onChange={onChange}
          error={error}
          disabled={disabled}
          multiline={schema.multiline}
        />
      );

    case 'number':
      return (
        <NumberField
          label={label}
          value={value as number || 0}
          onChange={onChange}
          min={schema.minimum}
          max={schema.maximum}
          error={error}
          disabled={disabled}
        />
      );

    case 'boolean':
      return (
        <ToggleField
          label={label}
          value={value as boolean || false}
          onChange={onChange}
          description={schema.description}
          disabled={disabled}
        />
      );

    case 'select':
      const selectOptions = (schema.enum || []).map((val, i) => ({
        value: val,
        label: schema.enumNames?.[i] || val,
      }));
      return (
        <SelectField
          label={label}
          value={value as string || ''}
          onChange={onChange}
          options={selectOptions}
          error={error}
          disabled={disabled}
        />
      );

    case 'color':
      return (
        <ColorField
          label={label}
          value={value as string || '#000000'}
          onChange={onChange}
          error={error}
          disabled={disabled}
        />
      );

    case 'contract':
      return (
        <ContractField
          label={label}
          value={value as string | null}
          onChange={onChange}
          error={error}
          disabled={disabled}
        />
      );

    default:
      return (
        <TextField
          label={label}
          value={String(value || '')}
          onChange={onChange}
          error={error}
          disabled={disabled}
        />
      );
  }
}

function formatLabel(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .replace(/_/g, ' ')
    .trim();
}
