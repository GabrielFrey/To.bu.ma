import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { Button } from '../Button';

// React Native Testing Library 14 renders and fires events asynchronously.
describe('Button', () => {
  it('reports its label and pressed state to the accessibility tree', async () => {
    const onPress = jest.fn();
    const view = await render(<Button label="Create sticker" onPress={onPress} testID="cta" />);

    const button = view.getByTestId('cta');
    expect(button).not.toBeBusy();
    expect(button).toBeEnabled();
    expect(view.getByText('Create sticker')).toBeOnTheScreen();

    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('cannot be pressed while loading, so an export cannot be started twice', async () => {
    const onPress = jest.fn();
    const view = await render(<Button label="Export" onPress={onPress} loading testID="cta" />);

    const button = view.getByTestId('cta');
    await fireEvent.press(button);

    expect(onPress).not.toHaveBeenCalled();
    expect(button).toBeBusy();
  });

  it('stays disabled when asked to', async () => {
    const onPress = jest.fn();
    const view = await render(<Button label="Generate" onPress={onPress} disabled testID="cta" />);

    await fireEvent.press(view.getByTestId('cta'));
    expect(onPress).not.toHaveBeenCalled();
    expect(view.getByTestId('cta')).toBeDisabled();
  });
});
