import React, { Component } from 'react';
import * as PropTypes from 'prop-types';
import { compose } from 'ramda';
import { createFragmentContainer } from 'react-relay';
import graphql from 'babel-plugin-relay/macro';
import { withStyles } from '@material-ui/core/styles';
import Paper from '@material-ui/core/Paper';
import Typography from '@material-ui/core/Typography';
import Markdown from 'react-markdown';
import Grid from '@material-ui/core/Grid';
import inject18n from '../../../../components/i18n';
import ExpandableMarkdown from '../../../../components/ExpandableMarkdown';

const styles = () => ({
  paper: {
    height: '100%',
    minHeight: '100%',
    margin: '10px 0 0 0',
    padding: '15px',
    borderRadius: 6,
  },
  item: {
    paddingLeft: 10,
    transition: 'background-color 0.1s ease',
    '&:hover': {
      background: 'rgba(0, 0, 0, 0.1)',
    },
  },
});

class SystemDetailsComponent extends Component {
  render() {
    const { t, classes, system } = this.props;
    return (
      <div style={{ height: '100%' }}>
        <Typography variant="h4" gutterBottom={true}>
          {t('Details')}
        </Typography>
        <Paper classes={{ root: classes.paper }} elevation={2}>
          <Grid container={true} spacing={3}>
            <Grid item={true} xs={6}>
              <Typography variant="h3" gutterBottom={true}>
                {t('Description')}
              </Typography>
              <ExpandableMarkdown source={system.description} limit={400} />
            </Grid>
            <Grid item={true} xs={6}>
              <Typography variant="h3" gutterBottom={true}>
                {t('Contact information')}
              </Typography>
              <Markdown className="markdown">
                {system.contact_information}
              </Markdown>
            </Grid>
          </Grid>
        </Paper>
      </div>
    );
  }
}

SystemDetailsComponent.propTypes = {
  system: PropTypes.object,
  classes: PropTypes.object,
  t: PropTypes.func,
  fld: PropTypes.func,
};

const SystemDetails = createFragmentContainer(SystemDetailsComponent, {
  system: graphql`
    fragment SystemDetails_system on System {
      id
      contact_information
      description
    }
  `,
});

export default compose(inject18n, withStyles(styles))(SystemDetails);
